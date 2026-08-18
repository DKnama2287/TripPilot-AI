# TripPilot AI ✈️ - A Multi-Agent Travel Planner with LangGraph

TripPilot AI is a FastAPI-based travel planner that generates a trip plan from a user's trip details, shows the result in a dashboard, lets the user chat about the trip, and stores saved plans in PostgreSQL.

## What it includes

- User signup and login
- Trip builder dashboard
- Flight search through the flight tool
- Hotel and trip research through Tavily
- AI itinerary generation with LangGraph and Groq
- Saved trips list
- Trip chat
- PDF export of the generated plan

## Requirements

- Python 3.11+
- PostgreSQL database
- API keys for:
  - `GROQ_API_KEY`
  - `TAVILY_API_KEY`
  - `AVIATIONSTACK_API_KEY`

## Setup

1. Install dependencies:

```bash
pip install -r requirements.txt
```

2. Create a `.env` file with your credentials:

```env
DATABASE_URL=postgresql://user:password@host:5432/database
GROQ_API_KEY=your_groq_key
TAVILY_API_KEY=your_tavily_key
AVIATIONSTACK_API_KEY=your_aviationstack_key
DEFAULT_ORIGIN_IATA=DAC
```

## Run

```bash
uvicorn app:app --reload
```

Or run:

```bash
python app.py
```

## Use

1. Open the app in your browser.
2. Sign up or log in.
3. Fill in the trip builder.
4. Generate the plan.
5. Use the dashboard, chat, saved trips, and PDF export as needed.

## Project files

- [app.py](app.py)
- [backend.py](backend.py)
- [templates/index.html](templates/index.html)
- [static/script.js](static/script.js)
- [static/style.css](static/style.css)
- [tools/flight_tool.py](tools/flight_tool.py)
- [tools/tavily_tool.py](tools/tavily_tool.py)
