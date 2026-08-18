from tools.tavily_tool import tavily_search
from tools.flight_tool import search_flights
from backend import run_travel_agent
# res = tavily_search("Best travel destinations in Europe")
# print(res)

# res2 = search_flights("plan a 7 day trip from nepal to europe")
# print(res2)

user_input = input("Enter travel request: ")

response = run_travel_agent(
    user_input=user_input,
    thread_id="test_user"
)

print("\nFINAL RESPONSE:\n")
print(response["answer"])
