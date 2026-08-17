from tools.tavily_tool import tavily_search
from tools.flight_tool import search_flights

# res = tavily_search("Best travel destinations in Europe")
# print(res)

res2 = search_flights("plan a 7 day trip from nepal to europe")
print(res2)
