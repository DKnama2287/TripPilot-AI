import os
import certifi
from dotenv import load_dotenv

load_dotenv()

os.environ["SSL_CERT_FILE"] = certifi.where()
os.environ["REQUESTS_CA_BUNDLE"] = certifi.where()

# LangSmith reads these variables when a LangChain run starts. A common .env
# mistake is putting the ``lsv2_...`` API key in LANGSMITH_ENDPOINT. That makes
# tracing fail before/while the graph runs, so ignore an invalid endpoint and
# let LangSmith use its default hosted endpoint instead.
langsmith_endpoint = os.getenv("LANGSMITH_ENDPOINT")
if langsmith_endpoint and not langsmith_endpoint.startswith(("http://", "https://")):
    os.environ.pop("LANGSMITH_ENDPOINT", None)

from typing import TypedDict, Annotated
import operator
import uuid

from psycopg_pool import ConnectionPool
from psycopg.rows import dict_row

from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.postgres import PostgresSaver
from langchain_core.messages import (
    AnyMessage,
    HumanMessage,
    AIMessage,
    SystemMessage,
)
from langchain_groq import ChatGroq
from tools.tavily_tool import tavily_search
from tools.flight_tool import search_flights


def get_supabase_database_url() -> str:
    """Return a PostgreSQL connection string for the Supabase project.

    Supabase exposes a standard PostgreSQL database, so LangGraph can use its
    native Postgres checkpointer.  Keep this URL server-side only; it is not
    the Supabase project URL or the browser-facing anon key.
    """
    database_url = (
        os.getenv("DATABASE_URL")
    )

    if not database_url:
        raise ValueError(
            "Supabase database URL is missing. Add DATABASE_URL (or "
            "SUPABASE_DB_URL) to .env using the PostgreSQL connection string "
            "from Supabase Dashboard → Connect."
        )

    if not database_url.startswith(("postgres://", "postgresql://")):
        raise ValueError(
            "The Supabase database URL must start with postgres:// or postgresql://."
        )

    # Supabase requires TLS for hosted database connections. Preserve an
    # explicit sslmode if the supplied connection string already has one.
    if "sslmode=" not in database_url:
        separator = "&" if "?" in database_url else "?"
        database_url = f"{database_url}{separator}sslmode=require"

    return database_url


GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise ValueError("GROQ_API_KEY is missing. Please add it to your .env file.")


# =========================
# LLM
# =========================

llm = ChatGroq(
    model="openai/gpt-oss-120b",
    api_key=GROQ_API_KEY
)


# =========================
# State
# =========================

class TravelState(TypedDict):
    messages: Annotated[list[AnyMessage], operator.add]
    user_query: str
    flight_results: str
    hotel_results: str
    itinerary: str
    llm_calls: int


# =========================
# Flight Agent
# =========================

def flight_agent(state: TravelState):
    query = state["user_query"]
    flight_data = search_flights(query)

    return {
        "flight_results": flight_data,
        "messages": [
            AIMessage(content="Flight results fetched.")
        ],
        "llm_calls": state.get("llm_calls", 0) + 1
    }



# =========================
# Hotel Agent
# =========================

def hotel_agent(state: TravelState):
    query = f"Best hotels for {state['user_query']}"
    hotel_results = tavily_search(query)

    return {
        "hotel_results": hotel_results,
        "messages": [
            AIMessage(content="Hotel information fetched.")
        ],
        "llm_calls": state.get("llm_calls", 0) + 1
    }




# =========================
# Itinerary Agent
# =========================

def itinerary_agent(state: TravelState):
    prompt = f"""
Create a complete travel itinerary from the user's trip brief.

User Query:
{state['user_query']}

Flight Results:
{state['flight_results']}

Hotel Results:
{state['hotel_results']}

Requirements:
- Respect origin, destination, dates, number of travellers, budget, hotel style,
  interests, and special needs from the user brief.
- If a critical detail is missing, state the assumption you used instead of
  inventing certainty.
- Build a realistic day-by-day route with morning, afternoon, and evening plans.
- Include local transport guidance, approximate travel time between clusters,
  meal/activity ideas, and pacing notes.
- Keep the plan budget-aware and easy to follow.
"""

    response = llm.invoke([
        SystemMessage(content="You are an expert itinerary designer who creates realistic, budget-aware travel routes."),
        HumanMessage(content=prompt)
    ])

    return {
        "itinerary": response.content,
        "messages": [response],
        "llm_calls": state.get("llm_calls", 0) + 1
    }



# =========================
# Final Response Agent
# =========================

def final_agent(state: TravelState):
    final_prompt = f"""
Generate the final travel response for the user from the available agent results.

User Request:
{state['user_query']}

Flights:
{state['flight_results']}

Hotels:
{state['hotel_results']}

Itinerary:
{state['itinerary']}

Format the final answer in clean Markdown using these sections:

1. Trip Summary
2. Key Assumptions
3. Flight Options
4. Hotel Shortlist
5. Day-by-Day Itinerary
6. Estimated Budget
7. Booking Checklist
8. Final Recommendations

Important:
- Start with a short summary containing route, duration, travellers, budget, and style.
- Use tables where they make flights, hotels, or budget easier to compare.
- Do not invent exact live prices, availability, reviews, or booking links when the
  tools did not provide them. Use estimated ranges and label them clearly.
- Mention that live flight APIs may not provide ticket prices when pricing is unavailable.
- Prefer recommendations that balance budget, convenience, quality, and traveller preferences.
- Add a concise follow-up question only if one missing detail blocks a reliable plan.
- Keep the answer useful for real booking decisions, not generic travel inspiration.
"""

    response = llm.invoke([
        SystemMessage(content="You are TripPilot AI, a professional travel planning assistant focused on practical booking-ready advice."),
        HumanMessage(content=final_prompt)
    ])

    return {
        "messages": [response],
        "llm_calls": state.get("llm_calls", 0) + 1
    }


# =========================
# Build Graph
# =========================

graph = StateGraph(TravelState)

graph.add_node("flight_agent", flight_agent)
graph.add_node("hotel_agent", hotel_agent)
graph.add_node("itinerary_agent", itinerary_agent)
graph.add_node("final_agent", final_agent)

graph.add_edge(START, "flight_agent")
graph.add_edge("flight_agent", "hotel_agent")
graph.add_edge("hotel_agent", "itinerary_agent")
graph.add_edge("itinerary_agent", "final_agent")
graph.add_edge("final_agent", END)


# =========================
# Supabase PostgreSQL checkpointer
# =========================
SUPABASE_DATABASE_URL = get_supabase_database_url()

# A pool is preferable to one global connection in FastAPI: concurrent API
# requests can safely obtain independent connections, and idle connections are
# reused. Prepared statements must be disabled when using a Supabase transaction
# pooler because the server connection can change between client requests.
db_pool = ConnectionPool(
    conninfo=SUPABASE_DATABASE_URL,
    min_size=1,
    max_size=10,
    kwargs={
        "autocommit": True,
        "row_factory": dict_row,
        "prepare_threshold": None,
    },
    open=True,
)

# Creates the LangGraph checkpoint tables in the configured Supabase database
# when they do not already exist.
checkpointer = PostgresSaver(db_pool)
checkpointer.setup()

travel_graph = graph.compile(checkpointer=checkpointer)


def close_database_pool() -> None:
    """Close Supabase connections during FastAPI application shutdown."""
    db_pool.close()



# =========================
# Function for FastAPI
# =========================

def run_travel_agent(user_input: str, thread_id: str | None = None):
    if not thread_id:
        thread_id = f"user_{uuid.uuid4().hex}"

    config = {
        "configurable": {
            "thread_id": thread_id
        }
    }

    result = travel_graph.invoke(
        {
            "messages": [
                HumanMessage(content=user_input)
            ],
            "user_query": user_input,
            "flight_results": "",
            "hotel_results": "",
            "itinerary": "",
            "llm_calls": 0
        },
        config=config
    )

    final_answer = result["messages"][-1].content

    return {
        "thread_id": thread_id,
        "answer": final_answer,
        "flight_results": result.get("flight_results", ""),
        "hotel_results": result.get("hotel_results", ""),
        "itinerary": result.get("itinerary", ""),
        "llm_calls": result.get("llm_calls", 0),
    }


def run_trip_chat_agent(user_message: str, trip_context: str = "") -> str:
    prompt = f"""
Current trip context:
{trip_context or "No generated trip plan yet."}

Traveller message:
{user_message}

Answer as a helpful in-app travel assistant. Keep the response concise and
actionable. If the user asks to change the plan, explain the best adjustment
and mention any tradeoffs in budget, timing, or comfort. If live availability
or exact prices are needed, say what should be checked before booking.

Chat formatting rules:
- Do not use Markdown tables, pipe tables, or long comparison grids.
- Use a short title, then compact bullet points.
- Keep line length friendly for a narrow chat panel.
- Use bold labels sparingly, for example **Breakfast:** or **Dinner:**.
- For food or hotel questions, group recommendations by category and include
  3 to 6 practical examples.
"""

    response = llm.invoke([
        SystemMessage(content="You are TripPilot Assistant, a concise travel copilot. Your replies appear in a narrow chat panel, so never use tables; use compact Markdown bullets."),
        HumanMessage(content=prompt),
    ])

    return response.content
