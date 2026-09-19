package database

import (
	"context"
	"fmt"
	"os"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

var Client *mongo.Client
var PollCollection *mongo.Collection
var UserCollection *mongo.Collection
var VoteCollection *mongo.Collection

func ConnectDatabase() {
	uri := os.Getenv("MONGODB_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}

	serverAPI := options.ServerAPI(options.ServerAPIVersion1)

	opts := options.Client().
		ApplyURI(uri).
		SetServerAPIOptions(serverAPI)

	ctx, cancel := context.WithTimeout(
		context.Background(),
		10*time.Second,
	)
	defer cancel()

	client, err := mongo.Connect(opts)

	if err != nil {
		panic("Failed to connect to MongoDB: " + err.Error())
	}

	err = client.Ping(ctx, nil)

	if err != nil {
		panic("Failed to ping MongoDB: " + err.Error())
	}

	Client = client

	db := client.Database("pulsevote")

	PollCollection = db.Collection("polls")
	UserCollection = db.Collection("users")
	VoteCollection = db.Collection("votes")

	// One user can vote only once in the same poll.
	_, err = VoteCollection.Indexes().CreateOne(
		ctx,
		mongo.IndexModel{
			Keys: bson.D{
				{Key: "poll_id", Value: 1},
				{Key: "user_id", Value: 1},
			},
			Options: options.Index().SetUnique(true),
		},
	)

	if err != nil {
		panic("Failed to create vote index: " + err.Error())
	}

	fmt.Println("MongoDB connected successfully!")
}
