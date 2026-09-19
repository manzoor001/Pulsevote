import { useEffect, useState } from "react";
import "./App.css";

const API_URL = "http://localhost:8080";
const WS_URL = "ws://localhost:8080/ws";

const getPollIdFromUrl = () => {
  const match = window.location.pathname.match(/^\/poll\/(\d+)$/);
  return match ? Number(match[1]) : null;
};

function App() {
  const [view, setView] = useState(() => {
    const pollId = getPollIdFromUrl();

    if (pollId) {
      return "poll";
    }

    const savedUser = localStorage.getItem("pulsevote_user");
    return savedUser ? "home" : "login";
  });

  const [poll, setPoll] = useState(null);
  const [loading, setLoading] = useState(false);
  const [voting, setVoting] = useState(false);
  const [selectedOption, setSelectedOption] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [liveConnected, setLiveConnected] = useState(false);

  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem("pulsevote_user");
    return savedUser ? JSON.parse(savedUser) : null;
  });

  const [token, setToken] = useState(() => {
    return localStorage.getItem("pulsevote_token");
  });

  const [authMode, setAuthMode] = useState("login");

  const [authForm, setAuthForm] = useState({
    name: "",
    email: "",
    password: "",
  });

  const [pollForm, setPollForm] = useState({
    question: "",
    options: ["", ""],
  });

  // ==================================================
  // LOAD POLL FROM URL
  // ==================================================

  useEffect(() => {
    const pollId = getPollIdFromUrl();

    if (pollId) {
      loadPoll(pollId);
    }
  }, []);

  // ==================================================
  // WEBSOCKET
  // ==================================================

  useEffect(() => {
    if (view !== "poll" || !poll) {
      return;
    }

    const socket = new WebSocket(WS_URL);

    socket.onopen = () => {
      setLiveConnected(true);

      try {
        socket.send(
          JSON.stringify({
            type: "subscribe",
            poll_id: poll.id,
          })
        );
      } catch (err) {
        console.log("WebSocket subscribe error:", err);
      }
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.poll) {
          setPoll(data.poll);
        }
      } catch (err) {
        console.log("WebSocket message error:", err);
      }
    };

    socket.onerror = () => {
      setLiveConnected(false);
    };

    socket.onclose = () => {
      setLiveConnected(false);
    };

    return () => {
      socket.close();
    };
  }, [view, poll?.id]);

  // ==================================================
  // LOAD POLL
  // ==================================================

  const loadPoll = async (pollId) => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `${API_URL}/api/polls/${pollId}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to load poll");
      }

      setPoll(data);
      setView("poll");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ==================================================
  // LOGIN / SIGNUP INPUT
  // ==================================================

  const handleAuthChange = (e) => {
    setAuthForm({
      ...authForm,
      [e.target.name]: e.target.value,
    });
  };

  // ==================================================
  // LOGIN / SIGNUP
  // ==================================================

  const handleAuthSubmit = async (e) => {
    e.preventDefault();

    setLoading(true);
    setError("");
    setMessage("");

    const endpoint =
      authMode === "login"
        ? "/api/auth/login"
        : "/api/auth/signup";

    try {
      const body =
        authMode === "login"
          ? {
              email: authForm.email,
              password: authForm.password,
            }
          : {
              name: authForm.name,
              email: authForm.email,
              password: authForm.password,
            };

      const response = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Authentication failed");
      }

      const loggedUser = data.user || data;
      const receivedToken = data.token;

      if (receivedToken) {
        localStorage.setItem(
          "pulsevote_token",
          receivedToken
        );
        setToken(receivedToken);
      }

      localStorage.setItem(
        "pulsevote_user",
        JSON.stringify(loggedUser)
      );

      setUser(loggedUser);
      setView("home");

      setAuthForm({
        name: "",
        email: "",
        password: "",
      });

      setMessage(
        authMode === "login"
          ? "Welcome back!"
          : "Account created successfully!"
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ==================================================
  // LOGOUT
  // ==================================================

  const logout = () => {
    localStorage.removeItem("pulsevote_user");
    localStorage.removeItem("pulsevote_token");

    setUser(null);
    setToken(null);
    setPoll(null);
    setView("login");
    setMessage("");
    setError("");
  };

  // ==================================================
  // POLL FORM
  // ==================================================

  const handlePollQuestionChange = (e) => {
    setPollForm({
      ...pollForm,
      question: e.target.value,
    });
  };

  const handleOptionChange = (index, value) => {
    const updatedOptions = [...pollForm.options];
    updatedOptions[index] = value;

    setPollForm({
      ...pollForm,
      options: updatedOptions,
    });
  };

  const addOption = () => {
    if (pollForm.options.length >= 6) {
      return;
    }

    setPollForm({
      ...pollForm,
      options: [...pollForm.options, ""],
    });
  };

  const removeOption = (index) => {
    if (pollForm.options.length <= 2) {
      return;
    }

    const updatedOptions = pollForm.options.filter(
      (_, optionIndex) => optionIndex !== index
    );

    setPollForm({
      ...pollForm,
      options: updatedOptions,
    });
  };

  // ==================================================
  // CREATE POLL
  // ==================================================

  const createPoll = async (e) => {
    e.preventDefault();

    if (!token) {
      setError("You must be logged in to create a poll.");
      return;
    }

    const cleanedOptions = pollForm.options
      .map((option) => option.trim())
      .filter(Boolean);

    if (!pollForm.question.trim()) {
      setError("Please enter a poll question.");
      return;
    }

    if (cleanedOptions.length < 2) {
      setError("Please provide at least 2 options.");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${API_URL}/api/polls`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          question: pollForm.question.trim(),
          options: cleanedOptions,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create poll");
      }

      setPollForm({
        question: "",
        options: ["", ""],
      });

      window.history.pushState(
        {},
        "",
        `/poll/${data.id}`
      );

      setPoll(data);
      setView("poll");
      setMessage("Poll created successfully!");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ==================================================
  // VOTE
  // ==================================================

  const vote = async (option) => {
    if (!token) {
      setError("You must be logged in to vote.");
      return;
    }

    if (!poll) {
      return;
    }

    setVoting(true);
    setSelectedOption(option);
    setMessage("");
    setError("");

    try {
      const response = await fetch(
        `${API_URL}/api/polls/${poll.id}/vote`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            option: option,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Failed to submit vote"
        );
      }

      setPoll(data.poll);
      setMessage(
        `Your vote for "${option}" was recorded!`
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setVoting(false);
    }
  };

  // ==================================================
  // NAVIGATION
  // ==================================================

  const goHome = () => {
    window.history.pushState({}, "", "/");
    setView("home");
    setPoll(null);
    setMessage("");
    setError("");
  };

  const goCreatePoll = () => {
    setView("create");
    setMessage("");
    setError("");
  };

  const openPoll = (pollId) => {
    window.history.pushState(
      {},
      "",
      `/poll/${pollId}`
    );

    loadPoll(pollId);
  };

  // ==================================================
  // LOADING
  // ==================================================

  if (loading && !poll && view === "poll") {
    return (
      <div className="loading-screen">
        <div className="loading-spinner"></div>
        <p>Loading PulseVote...</p>
      </div>
    );
  }

  // ==================================================
  // AUTH PAGE
  // ==================================================

  if (view === "login") {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">
            <span>⚡</span>
            <strong>PulseVote</strong>
          </div>

          <div className="auth-heading">
            <h1>
              {authMode === "login"
                ? "Welcome Back"
                : "Create Your Account"}
            </h1>

            <p>
              {authMode === "login"
                ? "Sign in to continue to your live voting dashboard."
                : "Join PulseVote and start creating live polls."}
            </p>
          </div>

          <form
            className="auth-form"
            onSubmit={handleAuthSubmit}
          >
            {authMode === "signup" && (
              <div className="form-group">
                <label>Full Name</label>

                <input
                  type="text"
                  name="name"
                  value={authForm.name}
                  onChange={handleAuthChange}
                  placeholder="Enter your name"
                  required
                />
              </div>
            )}

            <div className="form-group">
              <label>Email Address</label>

              <input
                type="email"
                name="email"
                value={authForm.email}
                onChange={handleAuthChange}
                placeholder="you@example.com"
                required
              />
            </div>

            <div className="form-group">
              <label>Password</label>

              <input
                type="password"
                name="password"
                value={authForm.password}
                onChange={handleAuthChange}
                placeholder="Enter your password"
                required
              />
            </div>

            {error && (
              <div className="error-message">
                ❌ {error}
              </div>
            )}

            {message && (
              <div className="success-message">
                ✅ {message}
              </div>
            )}

            <button
              type="submit"
              className="primary-button auth-button"
              disabled={loading}
            >
              {loading
                ? "Please wait..."
                : authMode === "login"
                ? "Login →"
                : "Create Account →"}
            </button>
          </form>

          <div className="auth-switch">
            {authMode === "login"
              ? "Don't have an account?"
              : "Already have an account?"}

            <button
              onClick={() => {
                setAuthMode(
                  authMode === "login"
                    ? "signup"
                    : "login"
                );
                setError("");
                setMessage("");
              }}
            >
              {authMode === "login"
                ? "Sign up"
                : "Login"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==================================================
  // HOME / DASHBOARD
  // ==================================================

  if (view === "home") {
    return (
      <div className="app-shell">
        <nav className="navbar">
          <div
            className="nav-logo"
            onClick={goHome}
          >
            <span>⚡</span>
            <strong>PulseVote</strong>
          </div>

          <div className="nav-right">
            <span className="nav-user">
              {user?.name || user?.email}
            </span>

            <button
              className="nav-logout"
              onClick={logout}
            >
              Logout
            </button>
          </div>
        </nav>

        <main className="dashboard-page">
          <section className="dashboard-hero">
            <div className="hero-content">
              <div className="hero-label">
                ⚡ PULSEDASH
              </div>

              <h1>
                Your Live Voting
                <br />
                <span>Command Center</span>
              </h1>

              <p>
                Create interactive polls, collect votes
                instantly, and watch results change
                in real time.
              </p>

              <button
                className="primary-button hero-button"
                onClick={goCreatePoll}
              >
                Create Live Poll →
              </button>
            </div>

            <div className="hero-visual">
              <div className="live-orb">
                <div className="live-orb-inner">
                  <span>LIVE</span>
                  <strong>⚡</strong>
                </div>
              </div>

              <div className="floating-badge badge-one">
                <span>📊</span>
                Real-time results
              </div>

              <div className="floating-badge badge-two">
                <span>🗳️</span>
                Instant voting
              </div>

              <div className="floating-badge badge-three">
                <span>🔗</span>
                Share anywhere
              </div>
            </div>
          </section>

          <section className="dashboard-stats">
            <div className="stat-card">
              <div className="stat-icon">⚡</div>
              <div>
                <strong>LIVE</strong>
                <span>Real-time updates</span>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon">🗳️</div>
              <div>
                <strong>1 VOTE</strong>
                <span>Per user protection</span>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon">🔗</div>
              <div>
                <strong>SHARE</strong>
                <span>Easy poll links</span>
              </div>
            </div>
          </section>

          <section className="how-section">
            <div className="section-heading">
              <span>HOW IT WORKS</span>
              <h2>
                From question to
                <br />
                live results.
              </h2>
            </div>

            <div className="steps-grid">
              <div className="step-card">
                <div className="step-number">01</div>
                <div className="step-icon">📝</div>
                <h3>Create</h3>
                <p>
                  Ask a question and add your voting
                  options.
                </p>
              </div>

              <div className="step-card">
                <div className="step-number">02</div>
                <div className="step-icon">🔗</div>
                <h3>Share</h3>
                <p>
                  Send your unique poll link to
                  participants.
                </p>
              </div>

              <div className="step-card">
                <div className="step-number">03</div>
                <div className="step-icon">⚡</div>
                <h3>Watch</h3>
                <p>
                  See votes and percentages update
                  instantly.
                </p>
              </div>
            </div>
          </section>

          <section className="dashboard-cta">
            <div>
              <span>READY TO START?</span>
              <h2>
                Put your question
                <br />
                to the crowd.
              </h2>
            </div>

            <button
              className="primary-button"
              onClick={goCreatePoll}
            >
              Launch a Poll →
            </button>
          </section>
        </main>

        <footer className="footer">
          <span>⚡ PulseVote</span>
          <span>Live voting made simple.</span>
        </footer>
      </div>
    );
  }

  // ==================================================
  // CREATE POLL
  // ==================================================

  if (view === "create") {
    return (
      <div className="app-shell">
        <nav className="navbar">
          <div
            className="nav-logo"
            onClick={goHome}
          >
            <span>⚡</span>
            <strong>PulseVote</strong>
          </div>

          <div className="nav-right">
            <span className="nav-user">
              {user?.name || user?.email}
            </span>

            <button
              className="nav-logout"
              onClick={logout}
            >
              Logout
            </button>
          </div>
        </nav>

        <main className="create-page">
          <div className="create-header">
            <span>📝 CREATE POLL</span>

            <h1>Create Your Live Poll</h1>

            <p>
              Ask a question. Add your options. Let the
              crowd decide.
            </p>
          </div>

          <form
            className="create-card"
            onSubmit={createPoll}
          >
            <div className="form-group">
              <label>YOUR QUESTION</label>

              <input
                type="text"
                value={pollForm.question}
                onChange={handlePollQuestionChange}
                placeholder="Which programming language do you prefer?"
                maxLength={200}
                required
              />

              <div className="character-count">
                {pollForm.question.length}/200
              </div>
            </div>

            <div className="options-heading">
              <div>
                <label>VOTING OPTIONS</label>
                <p>Add between 2 and 6 options.</p>
              </div>

              <span>
                {pollForm.options.length}/6
              </span>
            </div>

            <div className="create-options">
              {pollForm.options.map(
                (option, index) => (
                  <div
                    className="create-option-row"
                    key={index}
                  >
                    <span className="option-number">
                      {index + 1}
                    </span>

                    <input
                      type="text"
                      value={option}
                      onChange={(e) =>
                        handleOptionChange(
                          index,
                          e.target.value
                        )
                      }
                      placeholder={`Option ${
                        index + 1
                      }`}
                      maxLength={100}
                      required
                    />

                    {pollForm.options.length > 2 && (
                      <button
                        type="button"
                        className="remove-option"
                        onClick={() =>
                          removeOption(index)
                        }
                      >
                        ×
                      </button>
                    )}
                  </div>
                )
              )}
            </div>

            {pollForm.options.length < 6 && (
              <button
                type="button"
                className="add-option-button"
                onClick={addOption}
              >
                + Add another option
              </button>
            )}

            {error && (
              <div className="error-message">
                ❌ {error}
              </div>
            )}

            <div className="create-features">
              <div>
                <span>⚡</span>
                <strong>Real-time results</strong>
              </div>

              <div>
                <span>🔗</span>
                <strong>Shareable link</strong>
              </div>

              <div>
                <span>🛡️</span>
                <strong>One vote per user</strong>
              </div>
            </div>

            <button
              type="submit"
              className="primary-button launch-button"
              disabled={loading}
            >
              {loading
                ? "Launching..."
                : "Launch Live Poll →"}
            </button>
          </form>
        </main>

        <footer className="footer">
          <span>⚡ PulseVote</span>
          <span>Live voting made simple.</span>
        </footer>
      </div>
    );
  }

  // ==================================================
  // LIVE POLL
  // ==================================================

  if (view === "poll" && poll) {
    const voteCounts = poll?.vote_counts || {};

    const totalVotes = Object.values(voteCounts).reduce(
      (total, count) => total + Number(count),
      0
    );

    const highestVotes =
      poll.options.length > 0
        ? Math.max(
            ...poll.options.map(
              (option) =>
                Number(voteCounts[option] || 0)
            )
          )
        : 0;

    const pollLink = window.location.href;

    const copyPollLink = async () => {
      try {
        await navigator.clipboard.writeText(
          pollLink
        );

        setMessage(
          "Poll link copied to clipboard!"
        );

        setError("");
      } catch (err) {
        setError("Unable to copy poll link.");
      }
    };

    return (
      <div className="app-shell">
        <nav className="navbar">
          <div
            className="nav-logo"
            onClick={goHome}
          >
            <span>⚡</span>
            <strong>PulseVote</strong>
          </div>

          <div className="poll-nav-center">
            <span
              className={
                liveConnected
                  ? "live-status connected"
                  : "live-status"
              }
            >
              <span className="live-status-dot"></span>

              {liveConnected
                ? "LIVE"
                : "CONNECTING"}
            </span>
          </div>

          <div className="nav-right">
            <span className="nav-user">
              {user?.name || user?.email}
            </span>

            <button
              className="nav-logout"
              onClick={logout}
            >
              Logout
            </button>
          </div>
        </nav>

        <main className="poll-page">
          <div className="poll-page-header">
            <div>
              <span className="poll-label">
                LIVE POLL
              </span>

              <h1 style={{ color: "#000000" }}>Cast Your Vote</h1>

              <p>
                Choose an option and watch the results
                update live.
              </p>
            </div>

            <button
              className="secondary-button"
              onClick={goHome}
            >
              ← Dashboard
            </button>
          </div>

          <div className="poll-layout">
            {/* ==================================================
                MAIN POLL CARD
                ================================================== */}

            <section className="poll-main-card">
              <div className="poll-card-top">
                <span className="poll-live-badge">
                  <span></span>
                  LIVE NOW
                </span>

                <span className="poll-id">
                  POLL #{poll.id}
                </span>
              </div>

              <div className="poll-question">
                <h2>{poll.question}</h2>

                <p>
                  Created by{" "}
                  <strong>
                    {poll.creator_name ||
                      "PulseVote User"}
                  </strong>
                </p>
              </div>

              <div className="vote-options">
                {poll.options.map(
                  (option, index) => {
                    const count = Number(
                      voteCounts[option] || 0
                    );

                    const percentage =
                      totalVotes > 0
                        ? Math.round(
                            (count /
                              totalVotes) *
                              100
                          )
                        : 0;

                    const isHighest =
                      count === highestVotes &&
                      count > 0;

                    const isSelected =
                      selectedOption === option;

                    return (
                      <button
                        key={option}
                        className={`vote-option ${
                          isSelected
                            ? "selected"
                            : ""
                        }`}
                        onClick={() =>
                          vote(option)
                        }
                        disabled={voting}
                      >
                        <div className="vote-option-header">
                          <div className="vote-option-name">
                            <span className="vote-option-number">
                              {index + 1}
                            </span>

                            <span>
                              {option}
                            </span>
                          </div>

                          <div className="vote-option-percent">
                            {percentage}%

                            {isHighest && (
                              <span className="leading-badge">
                                LEADING
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="vote-progress">
                          <div
                            className={`vote-progress-fill ${
                              isHighest
                                ? "leading"
                                : ""
                            }`}
                            style={{
                              width: `${percentage}%`,
                            }}
                          />
                        </div>

                        <div className="vote-option-footer">
                          <span>
                            {count}{" "}
                            {count === 1
                              ? "vote"
                              : "votes"}
                          </span>

                          {isSelected && (
                            <span>
                              ✓ Selected
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  }
                )}
              </div>

              {message && (
                <div className="poll-success">
                  ✅ {message}
                </div>
              )}

              {error && (
                <div className="poll-error">
                  ❌ {error}
                </div>
              )}

              <div className="poll-card-footer">
                <span>
                  🛡️ One vote per user
                </span>

                <span>
                  ⚡ Results update automatically
                </span>
              </div>
            </section>

            {/* ==================================================
                SIDEBAR
                ================================================== */}

            <aside className="poll-sidebar">
              {/* TOTAL VOTES */}

              <div className="sidebar-stat-card">
                <span className="sidebar-stat-label">
                  TOTAL VOTES
                </span>

                <strong>{totalVotes}</strong>

                <span className="sidebar-stat-caption">
                  responses collected
                </span>
              </div>

              {/* LIVE STATUS */}

              <div className="sidebar-live-card">
                <div className="sidebar-live-card-top">
                  <span className="sidebar-live-icon">
                    ⚡
                  </span>

                  <div>
                    <strong>
                      {liveConnected
                        ? "Live Connection"
                        : "Connecting..."}
                    </strong>

                    <span>
                      {liveConnected
                        ? "Results are updating live"
                        : "Connecting to live server"}
                    </span>
                  </div>
                </div>
              </div>

              {/* ==================================================
                  PREMIUM CURRENT STANDINGS
                  ================================================== */}

              <div className="sidebar-results-card">
                <div className="sidebar-results-header">
                  <div>
                    <div className="sidebar-live-title">
                      <span className="sidebar-live-dot"></span>
                      LIVE RESULTS
                    </div>

                    <h3>
                      Current Standings
                    </h3>

                    <p className="sidebar-results-subtitle">
                      Updated automatically as votes arrive
                    </p>
                  </div>

                  <div className="results-chart-icon">
                    📊
                  </div>
                </div>

                {/* TOTAL RESPONSES */}

                <div className="sidebar-total-banner">
                  <div className="sidebar-total-icon">
                    🗳️
                  </div>

                  <div>
                    <span>
                      TOTAL RESPONSES
                    </span>

                    <strong>
                      {totalVotes}
                    </strong>

                    <small>
                      {totalVotes === 1
                        ? "response recorded"
                        : "responses recorded"}
                    </small>
                  </div>
                </div>

                {/* STANDINGS */}

                <div className="sidebar-result-list">
                  {poll.options.map(
                    (option, index) => {
                      const count = Number(
                        voteCounts[option] || 0
                      );

                      const percentage =
                        totalVotes > 0
                          ? Math.round(
                              (count /
                                totalVotes) *
                                100
                            )
                          : 0;

                      const isHighest =
                        count === highestVotes &&
                        count > 0;

                      return (
                        <div
                          className={`sidebar-result ${
                            isHighest
                              ? "sidebar-result-highest"
                              : ""
                          }`}
                          key={option}
                        >
                          <div className="sidebar-result-info">
                            <div className="sidebar-option-name">
                              <span
                                className={`sidebar-result-rank ${
                                  isHighest
                                    ? "sidebar-result-rank-top"
                                    : ""
                                }`}
                              >
                                {isHighest
                                  ? "★"
                                  : index + 1}
                              </span>

                              <span className="sidebar-option-text">
                                {option}
                              </span>
                            </div>

                            <div className="sidebar-result-percentage">
                              <strong>
                                {percentage}%
                              </strong>

                              {isHighest && (
                                <span className="top-result-label">
                                  TOP
                                </span>
                              )}
                            </div>
                          </div>

                          {/* PROGRESS BAR */}

                          <div className="sidebar-result-bar">
                            <div
                              className={`sidebar-result-fill ${
                                isHighest
                                  ? "sidebar-result-fill-top"
                                  : ""
                              }`}
                              style={{
                                width: `${percentage}%`,
                              }}
                            >
                              {percentage >= 20 && (
                                <span>
                                  {percentage}%
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="sidebar-result-bottom">
                            <span>
                              {count}{" "}
                              {count === 1
                                ? "vote"
                                : "votes"}
                            </span>

                            <span>
                              {percentage}% of total
                            </span>
                          </div>
                        </div>
                      );
                    }
                  )}
                </div>

                {/* FOOTER */}

                <div className="sidebar-results-footer">
                  <span>
                    ⚡ Live visualization
                  </span>

                  <span>
                    {poll.options.length}{" "}
                    {poll.options.length === 1
                      ? "option"
                      : "options"}
                  </span>
                </div>
              </div>

              {/* SHARE */}

              <div className="share-card">
                <div className="share-card-icon">
                  🔗
                </div>

                <div className="share-card-content">
                  <h3>Share this poll</h3>

                  <p>
                    Invite people to vote using this
                    link.
                  </p>
                </div>

                <button
                  className="copy-link-button"
                  onClick={copyPollLink}
                >
                  Copy Poll Link
                </button>
              </div>

              <button
                className="sidebar-back-button"
                onClick={goHome}
              >
                ← Back to Dashboard
              </button>
            </aside>
          </div>
        </main>

        <footer className="footer">
          <span>⚡ PulseVote</span>
          <span>
            Live voting made simple.
          </span>
        </footer>
      </div>
    );
  }

  // ==================================================
  // FALLBACK
  // ==================================================

  return (
    <div className="loading-screen">
      <div className="loading-spinner"></div>
      <p>Loading PulseVote...</p>
    </div>
  );
}

export default App;