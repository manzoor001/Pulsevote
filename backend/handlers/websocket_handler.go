package handlers

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	"pulsevote/database"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// WebSocketHandler handles live poll updates
func WebSocketHandler(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	pubsub := database.RedisClient.Subscribe(
		context.Background(),
		"poll_updates",
	)
	defer pubsub.Close()

	ch := pubsub.Channel()

	for {
		msg, ok := <-ch
		if !ok {
			break
		}

		err := conn.WriteMessage(
			websocket.TextMessage,
			[]byte(msg.Payload),
		)

		if err != nil {
			break
		}
	}
}