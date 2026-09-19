package main

import (
	"context"
	"net/http"
	"os"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"

	"pulsevote/database"
	"pulsevote/handlers"
	"pulsevote/middleware"
)

func main() {

	// --------------------------------------------------
	// CONNECT TO MONGODB
	// --------------------------------------------------

	database.ConnectDatabase()

	// --------------------------------------------------
	// CONNECT TO REDIS
	// --------------------------------------------------

	database.ConnectRedis()

	// --------------------------------------------------
	// SYNC EXISTING MONGODB VOTES TO REDIS
	// --------------------------------------------------

	if err := database.SyncPollVotesToRedis(
		context.Background(),
	); err != nil {
		panic("Failed to sync poll votes to Redis: " + err.Error())
	}

	// --------------------------------------------------
	// CREATE GIN ROUTER
	// --------------------------------------------------

	r := gin.Default()

	// --------------------------------------------------
	// CORS
	// --------------------------------------------------

	allowedOrigin := os.Getenv("FRONTEND_URL")

	if allowedOrigin == "" {
		allowedOrigin = "http://localhost:5173"
	}

	r.Use(cors.New(cors.Config{
		AllowOrigins: []string{
			allowedOrigin,
		},
		AllowMethods: []string{
			"GET",
			"POST",
			"PUT",
			"DELETE",
			"OPTIONS",
		},
		AllowHeaders: []string{
			"Origin",
			"Content-Type",
			"Accept",
			"Authorization",
		},
	}))

	// --------------------------------------------------
	// HEALTH CHECK
	// --------------------------------------------------

	r.GET("/health", func(c *gin.Context) {

		c.JSON(
			http.StatusOK,
			gin.H{
				"message": "PulseVote backend is running",
			},
		)
	})

	// --------------------------------------------------
	// WEBSOCKET
	// --------------------------------------------------

	r.GET("/ws", handlers.WebSocketHandler)

	// --------------------------------------------------
	// API ROUTES
	// --------------------------------------------------

	api := r.Group("/api")

	{
		// ----------------------------------------------
		// AUTHENTICATION
		// ----------------------------------------------

		api.POST(
			"/auth/signup",
			handlers.Signup,
		)

		api.POST(
			"/auth/login",
			handlers.Login,
		)

		// ----------------------------------------------
		// PUBLIC POLL ROUTES
		// ----------------------------------------------

		api.GET(
			"/polls",
			handlers.GetPolls,
		)

		api.GET(
			"/polls/:id",
			handlers.GetPoll,
		)

		api.GET(
			"/polls/:id/results",
			handlers.GetPollResults,
		)

		// ----------------------------------------------
		// PROTECTED ROUTES
		// ----------------------------------------------

		protected := api.Group("")

		protected.Use(
			middleware.AuthMiddleware(),
		)

		{
			// Create poll
			protected.POST(
				"/polls",
				handlers.CreatePoll,
			)

			// Vote
			protected.POST(
				"/polls/:id/vote",
				handlers.VotePoll,
			)
		}
	}

	// --------------------------------------------------
	// START SERVER
	// --------------------------------------------------

	port := os.Getenv("PORT")

	if port == "" {
		port = "8080"
	}

	r.Run(":" + port)
}
