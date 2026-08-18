let authMode = "login";
let currentUser = null;
let currentThreadId = localStorage.getItem("travel_thread_id") || null;
let latestAnswerMarkdown = "";
let savedTrips = [];
let hasActiveTrip = false;
let chatHistoryKey = null;

const presets = {
    japan: {
        origin: "Delhi, India",
        destination: "Tokyo & Kyoto, Japan",
        start: "2026-08-19",
        end: "2026-08-23",
        travellers: "2",
        budget: "Rs 2,50,000",
        style: "balanced",
        hotel: "clean, well-rated, convenient location",
        notes: "Japanese culture, Mount Fuji, local food, temples, shopping, easy trains, comfortable pace."
    },
    dubai: {
        origin: "Mumbai, India",
        destination: "Dubai, UAE",
        start: "",
        end: "",
        travellers: "4",
        budget: "Rs 3,00,000",
        style: "family-friendly",
        hotel: "family rooms or apartments",
        notes: "Family with kids, Burj Khalifa, desert safari, shopping, clean hotel near metro, not too hectic."
    },
    thailand: {
        origin: "Kolkata, India",
        destination: "Bangkok & Phuket, Thailand",
        start: "",
        end: "",
        travellers: "2",
        budget: "Rs 1,20,000",
        style: "budget-friendly",
        hotel: "budget hotels or hostels",
        notes: "Street food, beaches, island tour, nightlife, markets, keep transfers simple."
    },
    goa: {
        origin: "Bengaluru, India",
        destination: "Goa, India",
        start: "",
        end: "",
        travellers: "3",
        budget: "Rs 55,000",
        style: "adventure",
        hotel: "clean, well-rated, convenient location",
        notes: "Beaches, cafes, one water activity, budget nightlife, prefer North Goa."
    }
};

const agents = [
    ["Trip Understanding", "clipboard-check", "cyan"],
    ["Itinerary Agent", "map", "blue"],
    ["Flight Agent", "plane", "pink"],
    ["Budget Agent", "wallet", "amber"],
    ["Hotel Agent", "building-2", "blue"],
    ["Validation Agent", "badge-check", "purple"],
    ["Activity Agent", "ticket", "amber"],
    ["Final Response Agent", "message-square-text", "pink"]
];

const dayImages = [
    "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&w=500&q=80",
    "https://images.unsplash.com/photo-1542051841857-5f90071e7989?auto=format&fit=crop&w=500&q=80",
    "https://images.unsplash.com/photo-1578637387939-43c525550085?auto=format&fit=crop&w=500&q=80",
    "https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=500&q=80",
    "https://images.unsplash.com/photo-1524413840807-0c3cb6fa808d?auto=format&fit=crop&w=500&q=80"
];

const dayTitles = [
    "Arrival and check-in",
    "City highlights",
    "Nature and viewpoints",
    "Culture and local areas",
    "Departure"
];

const dayActivities = [
    ["Airport arrival", "Hotel check-in", "Easy dinner nearby", "Short evening walk"],
    ["Main landmark", "Local market", "Museum or temple", "Dinner district"],
    ["Scenic day trip", "Photo stop", "Relaxed lunch", "Return transfer"],
    ["Historic area", "Shopping street", "Signature food stop", "Evening view"],
    ["Breakfast", "Check-out", "Souvenir stop", "Airport departure"]
];

function initIcons() {
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

function getValue(id) {
    const element = document.getElementById(id);
    return element ? element.value.trim() : "";
}

function setValue(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.value = value || "";
    }
}

function moneyNumber(value) {
    const number = Number(String(value).replace(/[^0-9]/g, ""));
    return Number.isFinite(number) ? number : 0;
}

function formatMoney(number) {
    if (!number) return "Rs 0";
    return `Rs ${number.toLocaleString("en-IN")}`;
}

function daysBetween(start, end) {
    if (!start || !end) return 5;
    const startDate = new Date(start);
    const endDate = new Date(end);
    const diff = Math.round((endDate - startDate) / 86400000) + 1;
    return Math.max(1, diff || 1);
}

function formatDateRange(startDate, endDate) {
    if (startDate && endDate) return `${startDate} to ${endDate}`;
    if (startDate) return `starting ${startDate}`;
    if (endDate) return `ending ${endDate}`;
    return "flexible dates";
}

function getTripSummary() {
    const origin = getValue("originInput");
    const destination = getValue("destinationInput");
    const startDate = getValue("startDateInput");
    const endDate = getValue("endDateInput");
    const travellers = getValue("travellersInput") || "2";
    const budget = getValue("budgetInput") || "Rs 2,50,000";
    const style = getValue("styleInput") || "balanced";
    const hotel = getValue("hotelInput") || "clean, well-rated, convenient location";
    const notes = getValue("notesInput");
    const days = daysBetween(startDate, endDate);

    return {
        origin,
        destination,
        startDate,
        endDate,
        travellers,
        budget,
        style,
        hotel,
        notes,
        days,
        nights: Math.max(0, days - 1)
    };
}

function hasTripDetails() {
    return Boolean(getValue("originInput") || getValue("destinationInput") || getValue("budgetInput") || getValue("notesInput"));
}

function buildTravelPrompt() {
    const trip = getTripSummary();

    return [
        "Create a complete, practical travel plan using the details below.",
        "",
        `Origin: ${trip.origin || "not provided"}`,
        `Destination: ${trip.destination || "not provided"}`,
        `Dates: ${formatDateRange(trip.startDate, trip.endDate)}`,
        `Duration: ${trip.days} days and ${trip.nights} nights`,
        `Travellers: ${trip.travellers}`,
        `Total budget: ${trip.budget}`,
        `Trip style: ${trip.style}`,
        `Hotel preference: ${trip.hotel}`,
        `Interests and special needs: ${trip.notes || "not provided"}`,
        "",
        "Please include:",
        "- Trip summary and key assumptions.",
        "- Flight options or flight search guidance when live prices are unavailable.",
        "- Hotel shortlist with area, nightly estimate, pros, and best-fit traveller.",
        "- Realistic day-by-day itinerary with morning, afternoon, evening, food ideas, transport, and timing.",
        "- Budget breakdown for flights, hotels, activities, food, local transport, documents, and buffer.",
        "- Booking checklist, local tips, safety, weather, packing, visa or document notes.",
        "- Ask one concise follow-up question only if a missing detail blocks a reliable plan."
    ].join("\n");
}

function tripContextForChat() {
    const trip = getTripSummary();
    return [
        `Trip: ${trip.origin || "Unknown origin"} to ${trip.destination || "Unknown destination"}`,
        `Dates: ${formatDateRange(trip.startDate, trip.endDate)}`,
        `Travellers: ${trip.travellers}`,
        `Budget: ${trip.budget}`,
        `Style: ${trip.style}`,
        `Hotel: ${trip.hotel}`,
        `Notes: ${trip.notes || "none"}`,
        "",
        "Latest generated plan:",
        latestAnswerMarkdown || "No plan generated yet."
    ].join("\n");
}

function validateTripForm() {
    const missing = [];
    if (!getValue("originInput")) missing.push("from city");
    if (!getValue("destinationInput")) missing.push("destination");
    if (!getValue("travellersInput")) missing.push("travellers");
    if (!getValue("budgetInput")) missing.push("budget");

    if (missing.length) {
        showError(`Please add ${missing.join(", ")} before generating the plan.`);
        return false;
    }

    return true;
}

function renderAgents(isComplete = true) {
    const grid = document.getElementById("agentGrid");
    grid.innerHTML = agents.map(([name, icon, color]) => `
        <div class="agent-item">
            <span class="agent-icon ${color}"><i data-lucide="${icon}"></i></span>
            <div>
                <div class="agent-name"><span>${name}</span><small>${isComplete ? "Completed" : "Ready"}</small></div>
                <div class="agent-bar"><span style="width: ${isComplete ? "100" : "18"}%"></span></div>
            </div>
            <i class="check" data-lucide="${isComplete ? "check-circle-2" : "circle"}"></i>
        </div>
    `).join("");
    initIcons();
}

function renderSavedTrips() {
    const list = document.getElementById("savedTripList");
    const count = document.getElementById("savedTripCount");

    count.textContent = `${savedTrips.length} ${savedTrips.length === 1 ? "plan" : "plans"}`;

    if (!savedTrips.length) {
        list.innerHTML = `
            <div class="empty-state">
                <strong>No saved trips yet</strong>
                <span>Generate a plan and it will appear here for this user.</span>
            </div>
        `;
        return;
    }

    list.innerHTML = savedTrips.slice(0, 4).map((trip, index) => {
        const summary = trip.trip_summary || {};
        const title = summary.destination || "Saved trip";
        const meta = `${summary.days || "?"} days, ${summary.travellers || "?"} travellers`;
        return `
            <button class="saved-trip-item" type="button" onclick="selectSavedTrip(${index})">
                <strong>${title}</strong>
                <span>${meta}</span>
            </button>
        `;
    }).join("");
}

function selectSavedTrip(index) {
    const trip = savedTrips[index];
    if (!trip) return;

    const summary = trip.trip_summary || {};
    setValue("originInput", summary.origin || "");
    setValue("destinationInput", summary.destination || "");
    setValue("startDateInput", summary.startDate || "");
    setValue("endDateInput", summary.endDate || "");
    setValue("travellersInput", summary.travellers || "2");
    setValue("budgetInput", summary.budget || "");
    setValue("styleInput", summary.style || "balanced");
    setValue("hotelInput", summary.hotel || "clean, well-rated, convenient location");
    setValue("notesInput", summary.notes || "");
    latestAnswerMarkdown = trip.answer || "";
    currentThreadId = trip.thread_id || currentThreadId;
    if (currentThreadId) localStorage.setItem("travel_thread_id", currentThreadId);
    hasActiveTrip = true;
    updateDashboard();
    if (latestAnswerMarkdown) {
        showResult(latestAnswerMarkdown, currentThreadId || "saved-trip");
    }
    loadChatHistory(true);
}

function clearVisiblePlan() {
    latestAnswerMarkdown = "";
    hasActiveTrip = false;
    const resultSection = document.getElementById("resultSection");
    const resultBox = document.getElementById("resultBox");
    if (resultSection) resultSection.classList.add("hidden");
    if (resultBox) resultBox.innerHTML = "";
}

async function loadSavedTrips(selectLatest = true) {
    try {
        const response = await fetch("/api/trips");
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.error || "Could not load saved trips.");
        }
        savedTrips = data.trips || [];
        renderSavedTrips();

        if (savedTrips.length) {
            if (selectLatest) {
                const currentIndex = savedTrips.findIndex((trip) => trip.thread_id === currentThreadId);
                selectSavedTrip(currentIndex >= 0 ? currentIndex : 0);
            }
            return;
        }

        hasActiveTrip = false;
        currentThreadId = null;
        localStorage.removeItem("travel_thread_id");
        clearVisiblePlan();
        clearTripForm();
        await loadChatHistory(true);
        renderSavedTrips();
    } catch (error) {
        savedTrips = [];
        renderSavedTrips();
    }
}

function applyTheme(theme) {
    const isLight = theme === "light";
    document.body.classList.toggle("light-theme", isLight);
    const button = document.getElementById("themeToggle");
    if (button) {
        button.innerHTML = isLight ? '<i data-lucide="sun"></i>' : '<i data-lucide="moon"></i>';
    }
    localStorage.setItem("trip_theme", theme);
    initIcons();
}

function toggleTheme() {
    const nextTheme = document.body.classList.contains("light-theme") ? "dark" : "light";
    applyTheme(nextTheme);
}

function setupNavigation() {
    document.querySelectorAll(".nav-list a").forEach((link) => {
        link.addEventListener("click", function(event) {
            const target = document.querySelector(this.getAttribute("href"));
            if (!target) return;

            event.preventDefault();
            document.querySelectorAll(".nav-list a").forEach((item) => item.classList.remove("active"));
            this.classList.add("active");
            target.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
        });
    });
}

function renderDays() {
    const grid = document.getElementById("dayGrid");
    const trip = getTripSummary();
    if (!hasActiveTrip && !hasTripDetails()) {
        grid.innerHTML = `
            <article class="day-card empty-state">
                <header><span>START</span><span>New trip</span></header>
                <h4>Create your first itinerary</h4>
                <ul>
                    <li>Add origin and destination</li>
                    <li>Set travellers and budget</li>
                    <li>Generate a saved AI plan</li>
                </ul>
            </article>
        `;
        return;
    }

    const dayCount = Math.min(Math.max(trip.days, 3), 7);

    grid.innerHTML = Array.from({ length: dayCount }).map((_, index) => {
        const isLast = index === dayCount - 1;
        const title = isLast ? "Departure" : dayTitles[index % dayTitles.length];
        const items = isLast ? dayActivities[4] : dayActivities[index % dayActivities.length];

        return `
            <article class="day-card">
                <header><span>DAY ${index + 1}</span><span>${trip.startDate || "Flexible"}</span></header>
                <h4>${title}</h4>
                <img src="${dayImages[index % dayImages.length]}" alt="">
                <ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>
                <a href="#resultSection">${items.length} Activities</a>
            </article>
        `;
    }).join("");
}

function updateDashboard() {
    const trip = getTripSummary();
    const hasTrip = hasActiveTrip || hasTripDetails();
    const budget = hasTrip ? moneyNumber(trip.budget) || 0 : 0;
    const flights = Math.round(budget * 0.3);
    const hotels = Math.round(budget * 0.26);
    const activities = Math.round(budget * 0.14);
    const food = Math.round(budget * 0.1);
    const transport = Math.round(budget * 0.06);
    const remaining = budget - flights - hotels - activities - food - transport;
    const destination = trip.destination || "No active trip";

    document.getElementById("heroSubline").textContent = hasTrip
        ? `Here's your trip to ${destination}`
        : "Create your first trip or open a saved plan";
    document.getElementById("sideTripTitle").textContent = destination;
    document.getElementById("sideTripMeta").textContent = hasTrip
        ? `${trip.days} days, ${trip.travellers} travellers`
        : "No saved plan selected";
    document.getElementById("statDays").textContent = hasTrip ? `${trip.days} Days` : "0 Days";
    document.getElementById("statNights").textContent = hasTrip ? `${trip.nights} Nights` : "0 Nights";
    document.getElementById("statTravellers").textContent = hasTrip ? `${trip.travellers} Travellers` : "0 Travellers";
    document.getElementById("statBudget").textContent = hasTrip ? trip.budget : "Rs 0";
    document.getElementById("statStyle").textContent = hasTrip ? trip.style.replace("-", " ") : "Not set";
    document.getElementById("budgetTotal").textContent = formatMoney(budget);
    document.getElementById("budgetFlights").textContent = formatMoney(flights);
    document.getElementById("budgetHotels").textContent = formatMoney(hotels);
    document.getElementById("budgetActivities").textContent = formatMoney(activities);
    document.getElementById("budgetFood").textContent = formatMoney(food);
    document.getElementById("budgetTransport").textContent = formatMoney(transport);
    document.getElementById("remainingBudget").textContent = formatMoney(Math.max(remaining, 0));
    renderDays();
}

function loadPreset(name) {
    const preset = presets[name];
    if (!preset) return;

    setValue("originInput", preset.origin);
    setValue("destinationInput", preset.destination);
    setValue("startDateInput", preset.start);
    setValue("endDateInput", preset.end);
    setValue("travellersInput", preset.travellers);
    setValue("budgetInput", preset.budget);
    setValue("styleInput", preset.style);
    setValue("hotelInput", preset.hotel);
    setValue("notesInput", preset.notes);
    hideError();
    hasActiveTrip = true;
    updateDashboard();
}

function clearTripForm() {
    ["originInput", "destinationInput", "startDateInput", "endDateInput", "budgetInput", "notesInput"].forEach((id) => setValue(id, ""));
    setValue("travellersInput", "2");
    setValue("styleInput", "balanced");
    setValue("hotelInput", "clean, well-rated, convenient location");
    hidePromptPreview();
    hideError();
    hasActiveTrip = false;
    updateDashboard();
}

function previewPrompt() {
    document.getElementById("promptText").textContent = buildTravelPrompt();
    document.getElementById("promptPreview").classList.remove("hidden");
}

function hidePromptPreview() {
    document.getElementById("promptPreview").classList.add("hidden");
}

function setLoading(isLoading) {
    const sendBtn = document.getElementById("sendBtn");
    const btnText = document.getElementById("btnText");
    const btnLoader = document.getElementById("btnLoader");

    sendBtn.disabled = isLoading;
    btnText.classList.toggle("hidden", isLoading);
    btnLoader.classList.toggle("hidden", !isLoading);
}

function showError(message) {
    const box = document.getElementById("errorBox");
    box.textContent = message;
    box.classList.remove("hidden");
}

function hideError() {
    const box = document.getElementById("errorBox");
    box.textContent = "";
    box.classList.add("hidden");
}

function showResult(answer, threadId) {
    latestAnswerMarkdown = answer;
    const resultBox = document.getElementById("resultBox");

    if (typeof marked !== "undefined") {
        resultBox.innerHTML = marked.parse(answer);
    } else {
        resultBox.innerText = answer;
    }

    document.getElementById("threadInfo").textContent = `Thread ID: ${threadId}`;
    document.getElementById("resultSection").classList.remove("hidden");
    if (chatHistoryKey !== threadId) {
        resetChat();
    }
    addChatBubble("assistant", "Your trip plan is ready. Ask me to adjust the budget, swap hotels, add restaurants, or make the itinerary slower.");
    chatHistoryKey = threadId;
    renderAgents(true);
    initIcons();
}

async function sendMessage() {
    hideError();
    if (!validateTripForm()) return;

    setLoading(true);

    try {
        const response = await fetch("/api/travel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message: buildTravelPrompt(),
                thread_id: currentThreadId,
                trip_summary: getTripSummary()
            })
        });
        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || "Something went wrong.");
        }

        currentThreadId = data.thread_id;
        localStorage.setItem("travel_thread_id", currentThreadId);
        hasActiveTrip = true;
        showResult(data.answer, data.thread_id);
        await loadSavedTrips(false);
    } catch (error) {
        if (String(error.message).toLowerCase().includes("login")) {
            showAuth();
        }
        showError(error.message);
    } finally {
        setLoading(false);
    }
}

function copyResult() {
    const text = document.getElementById("resultBox").innerText;
    if (!text) return;

    navigator.clipboard.writeText(text).then(() => {
        const copyBtn = document.querySelector(".copy-btn");
        copyBtn.innerHTML = '<i data-lucide="check"></i>Copied';
        initIcons();
        setTimeout(() => {
            copyBtn.innerHTML = '<i data-lucide="copy"></i>Copy';
            initIcons();
        }, 1400);
    }).catch(() => showError("Could not copy result."));
}

function copyShareLink() {
    navigator.clipboard.writeText(window.location.href).catch(() => {});
}

function downloadPDF() {
    const pdfContent = document.getElementById("pdfContent");
    if (!latestAnswerMarkdown || !pdfContent) {
        showError("No travel plan available to download.");
        return;
    }

    const downloadBtn = document.querySelector(".download-btn");
    downloadBtn.innerHTML = "Preparing";
    downloadBtn.disabled = true;

    html2pdf()
        .set({
            margin: 0.5,
            filename: "trip-pilot-ai-plan.pdf",
            image: { type: "jpeg", quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
            jsPDF: { unit: "in", format: "a4", orientation: "portrait" },
            pagebreak: { mode: ["avoid-all", "css", "legacy"] }
        })
        .from(pdfContent)
        .save()
        .then(() => {
            downloadBtn.innerHTML = '<i data-lucide="download"></i>PDF';
            downloadBtn.disabled = false;
            initIcons();
        })
        .catch(() => {
            downloadBtn.innerHTML = '<i data-lucide="download"></i>PDF';
            downloadBtn.disabled = false;
            initIcons();
            showError("Could not download PDF.");
        });
}

function setAuthMode(mode) {
    authMode = mode;
    document.getElementById("loginTab").classList.toggle("active", mode === "login");
    document.getElementById("signupTab").classList.toggle("active", mode === "signup");
    document.getElementById("nameField").classList.toggle("hidden", mode === "login");
    document.getElementById("authSubmit").innerHTML = mode === "login"
        ? '<i data-lucide="log-in"></i>Continue'
        : '<i data-lucide="user-plus"></i>Create Account';
    document.getElementById("authError").classList.add("hidden");
    initIcons();
}

function showAuth() {
    document.getElementById("authOverlay").classList.remove("hidden");
}

function hideAuth() {
    document.getElementById("authOverlay").classList.add("hidden");
}

function setUser(user) {
    currentUser = user;
    const name = user.name || "Traveller";
    document.getElementById("userName").textContent = name;
    document.getElementById("welcomeName").textContent = name;
    document.getElementById("userEmail").textContent = user.email || "";
    document.getElementById("userAvatar").textContent = name.slice(0, 1).toUpperCase();
    loadSavedTrips();
}

async function submitAuth(event) {
    event.preventDefault();
    const errorBox = document.getElementById("authError");
    errorBox.classList.add("hidden");

    try {
        const response = await fetch(`/api/auth/${authMode}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: getValue("authName"),
                email: getValue("authEmail"),
                password: getValue("authPassword")
            })
        });
        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || "Authentication failed.");
        }

        setUser(data.user);
        hideAuth();
    } catch (error) {
        errorBox.textContent = error.message;
        errorBox.classList.remove("hidden");
    }
}

async function checkAuth() {
    try {
        const response = await fetch("/api/auth/me");
        const data = await response.json();
        if (response.ok && data.success) {
            setUser(data.user);
            hideAuth();
            return;
        }
    } catch (error) {
        // The modal stays open when the session cannot be checked.
    }
    showAuth();
}

async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    currentUser = null;
    savedTrips = [];
    clearVisiblePlan();
    renderSavedTrips();
    showAuth();
}

function addChatBubble(role, text, pending = false) {
    const messages = document.getElementById("chatMessages");
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${role}${pending ? " pending" : ""}`;
    setChatBubbleContent(bubble, text, role);
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
    return bubble;
}

function setChatBubbleContent(bubble, text, role) {
    if (role === "assistant" && typeof marked !== "undefined") {
        bubble.innerHTML = marked.parse(text);
        return;
    }

    bubble.textContent = text;
}

function resetChat() {
    const messages = document.getElementById("chatMessages");
    messages.innerHTML = "";
    chatHistoryKey = currentThreadId || "general";
    addChatBubble("assistant", "Hi! I can help modify your itinerary, find alternatives, adjust budget, suggest restaurants, and answer travel questions.");
}

async function loadChatHistory(force = false) {
    const threadId = currentThreadId || "general";
    const messagesBox = document.getElementById("chatMessages");

    if (!currentUser || !messagesBox || (!force && chatHistoryKey === threadId)) {
        return;
    }

    try {
        const response = await fetch(`/api/chat?thread_id=${encodeURIComponent(threadId)}`);
        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || "Could not load chat history.");
        }

        messagesBox.innerHTML = "";
        if (data.messages && data.messages.length) {
            data.messages.forEach((message) => {
                addChatBubble(message.role === "assistant" ? "assistant" : "user", message.content);
            });
        } else {
            addChatBubble("assistant", "Hi! I can help modify your itinerary, find alternatives, adjust budget, suggest restaurants, and answer travel questions.");
        }
        chatHistoryKey = threadId;
    } catch (error) {
        resetChat();
    }
}

async function sendChat(event) {
    event.preventDefault();
    const input = document.getElementById("chatInput");
    const message = input.value.trim();
    if (!message) return;

    addChatBubble("user", message);
    input.value = "";
    const pending = addChatBubble("assistant", "Thinking...", true);

    try {
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message,
                trip_context: tripContextForChat(),
                thread_id: currentThreadId || "general"
            })
        });
        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || "Chat failed.");
        }

        pending.classList.remove("pending");
        setChatBubbleContent(pending, data.answer, "assistant");
    } catch (error) {
        pending.classList.remove("pending");
        pending.textContent = error.message;
        if (String(error.message).toLowerCase().includes("login")) {
            showAuth();
        }
    }
}

function toggleAssistant() {
    document.querySelector(".assistant-panel").classList.toggle("hidden");
    document.getElementById("chatFab").classList.toggle("hidden");
    initIcons();
}

document.addEventListener("keydown", function(event) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        sendMessage();
    }
});

document.addEventListener("input", function(event) {
    if (event.target.closest("#tripBuilder")) {
        updateDashboard();
    }
});

document.addEventListener("DOMContentLoaded", function() {
    applyTheme(localStorage.getItem("trip_theme") || "dark");
    renderAgents(false);
    renderDays();
    renderSavedTrips();
    resetChat();
    initIcons();
    setupNavigation();
    checkAuth();
});
