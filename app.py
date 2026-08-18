from datetime import datetime, timedelta, timezone
from pathlib import Path
import base64
import hashlib
import secrets
import traceback

import uvicorn
from fastapi import Cookie, FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from psycopg.types.json import Jsonb

from backend import db_pool, run_travel_agent, run_trip_chat_agent

BASE_DIR = Path(__file__).resolve().parent
SESSION_DAYS = 14

app = FastAPI(
    title="TripPilot AI",
    description="LangGraph Multi-Agent Travel Planner with FastAPI Frontend",
    version="1.0.0",
)

app.mount(
    "/static",
    StaticFiles(directory=str(BASE_DIR / "static")),
    name="static",
)

templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


class TravelRequest(BaseModel):
    message: str
    thread_id: str | None = None
    trip_summary: dict | None = None


class AuthRequest(BaseModel):
    name: str | None = None
    email: str
    password: str


class ChatRequest(BaseModel):
    message: str
    trip_context: str | None = None
    thread_id: str | None = None


def setup_app_tables() -> None:
    with db_pool.connection() as conn:
        conn.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS trip_users (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS trip_sessions (
                token TEXT PRIMARY KEY,
                user_id UUID NOT NULL REFERENCES trip_users(id) ON DELETE CASCADE,
                expires_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS saved_trips (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL REFERENCES trip_users(id) ON DELETE CASCADE,
                thread_id TEXT,
                request TEXT NOT NULL,
                answer TEXT NOT NULL,
                trip_summary JSONB,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS trip_chat_messages (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL REFERENCES trip_users(id) ON DELETE CASCADE,
                thread_id TEXT,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 180000)
    return (
        base64.b64encode(salt).decode("ascii")
        + "$"
        + base64.b64encode(digest).decode("ascii")
    )


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt_text, digest_text = stored_hash.split("$", 1)
        salt = base64.b64decode(salt_text)
        expected = base64.b64decode(digest_text)
    except ValueError:
        return False

    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 180000)
    return secrets.compare_digest(actual, expected)


def public_user(user: dict) -> dict:
    return {
        "id": str(user["id"]),
        "name": user["name"],
        "email": user["email"],
    }


def create_session_response(user: dict) -> JSONResponse:
    token = secrets.token_urlsafe(40)
    expires_at = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)

    with db_pool.connection() as conn:
        conn.execute(
            """
            INSERT INTO trip_sessions (token, user_id, expires_at)
            VALUES (%s, %s, %s)
            """,
            (token, user["id"], expires_at),
        )

    response = JSONResponse(
        content={
            "success": True,
            "user": public_user(user),
        }
    )
    response.set_cookie(
        key="trip_session",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=SESSION_DAYS * 24 * 60 * 60,
    )
    return response


def get_current_user(session_token: str | None) -> dict | None:
    if not session_token:
        return None

    with db_pool.connection() as conn:
        return conn.execute(
            """
            SELECT u.id, u.name, u.email
            FROM trip_sessions s
            JOIN trip_users u ON u.id = s.user_id
            WHERE s.token = %s AND s.expires_at > now()
            """,
            (session_token,),
        ).fetchone()


setup_app_tables()


@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={},
    )


@app.post("/api/travel")
async def travel_planner(
    request_data: TravelRequest,
    trip_session: str | None = Cookie(default=None),
):
    try:
        user = get_current_user(trip_session)
        if not user:
            return JSONResponse(
                status_code=401,
                content={"success": False, "error": "Please login first."},
            )

        user_message = request_data.message.strip()
        if not user_message:
            return JSONResponse(
                status_code=400,
                content={"success": False, "error": "Message cannot be empty."},
            )

        result = run_travel_agent(
            user_input=user_message,
            thread_id=request_data.thread_id,
        )

        with db_pool.connection() as conn:
            conn.execute(
                """
                INSERT INTO saved_trips (user_id, thread_id, request, answer, trip_summary)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    user["id"],
                    result["thread_id"],
                    user_message,
                    result["answer"],
                    Jsonb(request_data.trip_summary or {}),
                ),
            )

        return JSONResponse(
            content={
                "success": True,
                "thread_id": result["thread_id"],
                "answer": result["answer"],
                "flight_results": result["flight_results"],
                "hotel_results": result["hotel_results"],
                "itinerary": result["itinerary"],
                "llm_calls": result["llm_calls"],
            }
        )
    except Exception as e:
        print("ERROR:", e)
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": str(e)},
        )


@app.get("/api/trips")
async def list_trips(trip_session: str | None = Cookie(default=None)):
    try:
        user = get_current_user(trip_session)
        if not user:
            return JSONResponse(
                status_code=401,
                content={"success": False, "error": "Please login first."},
            )

        with db_pool.connection() as conn:
            trips = conn.execute(
                """
                SELECT id, thread_id, request, answer, trip_summary, created_at
                FROM saved_trips
                WHERE user_id = %s
                ORDER BY created_at DESC
                LIMIT 20
                """,
                (user["id"],),
            ).fetchall()

        return {
            "success": True,
            "trips": [
                {
                    "id": str(trip["id"]),
                    "thread_id": trip["thread_id"],
                    "request": trip["request"],
                    "answer": trip["answer"],
                    "trip_summary": trip["trip_summary"] or {},
                    "created_at": trip["created_at"].isoformat(),
                }
                for trip in trips
            ],
        }
    except Exception as e:
        print("TRIPS ERROR:", e)
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": str(e)},
        )


@app.post("/api/auth/signup")
async def signup(request_data: AuthRequest):
    try:
        email = request_data.email.strip().lower()
        password = request_data.password.strip()
        name = (request_data.name or email.split("@")[0]).strip()

        if not email or "@" not in email:
            return JSONResponse(
                status_code=400,
                content={"success": False, "error": "Enter a valid email address."},
            )

        if len(password) < 6:
            return JSONResponse(
                status_code=400,
                content={"success": False, "error": "Password must be at least 6 characters."},
            )

        with db_pool.connection() as conn:
            existing = conn.execute(
                "SELECT id FROM trip_users WHERE email = %s",
                (email,),
            ).fetchone()

            if existing:
                return JSONResponse(
                    status_code=409,
                    content={"success": False, "error": "This email is already registered."},
                )

            user = conn.execute(
                """
                INSERT INTO trip_users (name, email, password_hash)
                VALUES (%s, %s, %s)
                RETURNING id, name, email
                """,
                (name, email, hash_password(password)),
            ).fetchone()

        return create_session_response(user)
    except Exception as e:
        print("SIGNUP ERROR:", e)
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": str(e)},
        )


@app.post("/api/auth/login")
async def login(request_data: AuthRequest):
    try:
        email = request_data.email.strip().lower()
        password = request_data.password.strip()

        with db_pool.connection() as conn:
            user = conn.execute(
                "SELECT id, name, email, password_hash FROM trip_users WHERE email = %s",
                (email,),
            ).fetchone()

        if not user or not verify_password(password, user["password_hash"]):
            return JSONResponse(
                status_code=401,
                content={"success": False, "error": "Invalid email or password."},
            )

        return create_session_response(user)
    except Exception as e:
        print("LOGIN ERROR:", e)
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": str(e)},
        )


@app.get("/api/auth/me")
async def me(trip_session: str | None = Cookie(default=None)):
    user = get_current_user(trip_session)
    if not user:
        return JSONResponse(
            status_code=401,
            content={"success": False, "error": "Not logged in."},
        )

    return {
        "success": True,
        "user": public_user(user),
    }


@app.post("/api/auth/logout")
async def logout(trip_session: str | None = Cookie(default=None)):
    if trip_session:
        with db_pool.connection() as conn:
            conn.execute("DELETE FROM trip_sessions WHERE token = %s", (trip_session,))

    response = JSONResponse(content={"success": True})
    response.delete_cookie("trip_session")
    return response


@app.post("/api/chat")
async def chat_agent(
    request_data: ChatRequest,
    trip_session: str | None = Cookie(default=None),
):
    try:
        user = get_current_user(trip_session)
        if not user:
            return JSONResponse(
                status_code=401,
                content={"success": False, "error": "Please login first."},
            )

        message = request_data.message.strip()
        if not message:
            return JSONResponse(
                status_code=400,
                content={"success": False, "error": "Message cannot be empty."},
            )

        answer = run_trip_chat_agent(
            user_message=message,
            trip_context=request_data.trip_context or "",
        )

        with db_pool.connection() as conn:
            conn.execute(
                """
                INSERT INTO trip_chat_messages (user_id, thread_id, role, content)
                VALUES (%s, %s, %s, %s), (%s, %s, %s, %s)
                """,
                (
                    user["id"],
                    request_data.thread_id,
                    "user",
                    message,
                    user["id"],
                    request_data.thread_id,
                    "assistant",
                    answer,
                ),
            )

        return {
            "success": True,
            "answer": answer,
        }
    except Exception as e:
        print("CHAT ERROR:", e)
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": str(e)},
        )


@app.get("/api/chat")
async def chat_history(
    thread_id: str = "general",
    trip_session: str | None = Cookie(default=None),
):
    try:
        user = get_current_user(trip_session)
        if not user:
            return JSONResponse(
                status_code=401,
                content={"success": False, "error": "Please login first."},
            )

        with db_pool.connection() as conn:
            messages = conn.execute(
                """
                SELECT role, content, created_at
                FROM trip_chat_messages
                WHERE user_id = %s AND COALESCE(thread_id, 'general') = %s
                ORDER BY created_at ASC
                LIMIT 80
                """,
                (user["id"], thread_id or "general"),
            ).fetchall()

        return {
            "success": True,
            "messages": [
                {
                    "role": message["role"],
                    "content": message["content"],
                    "created_at": message["created_at"].isoformat(),
                }
                for message in messages
            ],
        }
    except Exception as e:
        print("CHAT HISTORY ERROR:", e)
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": str(e)},
        )


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "message": "AI Travel Planner API is running",
    }


@app.get("/favicon.ico")
async def favicon():
    return JSONResponse(content={})


if __name__ == "__main__":
    uvicorn.run(
        "app:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
    )
