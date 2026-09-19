package database

import (
	"context"
	"fmt"

	"github.com/redis/go-redis/v9"
	"go.mongodb.org/mongo-driver/v2/bson"

	"pulsevote/models"
)

var RedisClient *redis.Client

func ConnectRedis() {
	RedisClient = redis.NewClient(&redis.Options{
		Addr: "localhost:6379",
	})

	_, err := RedisClient.Ping(context.Background()).Result()

	if err != nil {
		panic("Failed to connect to Redis: " + err.Error())
	}

	fmt.Println("Redis connected successfully!")
}

// --------------------------------------------------
// REDIS KEY
// --------------------------------------------------

func PollVotesKey(pollID int) string {
	return fmt.Sprintf("poll:%d:votes", pollID)
}

// --------------------------------------------------
// INITIALIZE POLL VOTE COUNTS
// --------------------------------------------------

func InitializePollVotes(
	ctx context.Context,
	pollID int,
	options []string,
) error {

	key := PollVotesKey(pollID)

	values := make(map[string]interface{})

	for _, option := range options {
		values[option] = 0
	}

	return RedisClient.HSet(
		ctx,
		key,
		values,
	).Err()
}

// --------------------------------------------------
// INCREMENT LIVE VOTE COUNT
// --------------------------------------------------

func IncrementPollVote(
	ctx context.Context,
	pollID int,
	option string,
) (int64, error) {

	return RedisClient.HIncrBy(
		ctx,
		PollVotesKey(pollID),
		option,
		1,
	).Result()
}

// --------------------------------------------------
// GET LIVE VOTE COUNTS
// --------------------------------------------------

func GetPollVoteCounts(
	ctx context.Context,
	pollID int,
) (map[string]int, error) {

	data, err := RedisClient.HGetAll(
		ctx,
		PollVotesKey(pollID),
	).Result()

	if err != nil {
		return nil, err
	}

	counts := make(map[string]int)

	for option, value := range data {

		var count int

		_, err := fmt.Sscanf(
			value,
			"%d",
			&count,
		)

		if err != nil {
			return nil, err
		}

		counts[option] = count
	}

	return counts, nil
}

// --------------------------------------------------
// SYNC EXISTING MONGODB VOTES TO REDIS
// --------------------------------------------------

func SyncPollVotesToRedis(ctx context.Context) error {

	cursor, err := PollCollection.Find(
		ctx,
		bson.M{},
	)

	if err != nil {
		return err
	}

	defer cursor.Close(ctx)

	var polls []models.Poll

	if err := cursor.All(ctx, &polls); err != nil {
		return err
	}

	for _, poll := range polls {

		// Start the poll with all options at zero.
		err := InitializePollVotes(
			ctx,
			poll.ID,
			poll.Options,
		)

		if err != nil {
			return err
		}

		// Get all votes already stored in MongoDB.
		voteCursor, err := VoteCollection.Find(
			ctx,
			bson.M{
				"poll_id": poll.ID,
			},
		)

		if err != nil {
			return err
		}

		var votes []models.Vote

		if err := voteCursor.All(ctx, &votes); err != nil {
			voteCursor.Close(ctx)
			return err
		}

		voteCursor.Close(ctx)

		// Rebuild Redis counts.
		for _, vote := range votes {

			_, err := IncrementPollVote(
				ctx,
				poll.ID,
				vote.Option,
			)

			if err != nil {
				return err
			}
		}
	}

	fmt.Println("MongoDB votes synchronized to Redis!")

	return nil
}
