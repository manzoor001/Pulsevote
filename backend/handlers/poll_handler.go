package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"

	"pulsevote/database"
	"pulsevote/models"
)

func getPollsCollection() *mongo.Collection {
	return database.PollCollection
}

// ==================================================
// CREATE POLL
// ==================================================

func CreatePoll(c *gin.Context) {

	var poll models.Poll

	if err := c.ShouldBindJSON(&poll); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid request",
		})
		return
	}

	// -----------------------------------------------
	// VALIDATE QUESTION
	// -----------------------------------------------

	poll.Question = strings.TrimSpace(poll.Question)

	if poll.Question == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Question is required",
		})
		return
	}

	if len(poll.Question) > 200 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Question must be 200 characters or less",
		})
		return
	}

	// -----------------------------------------------
	// VALIDATE OPTIONS
	// -----------------------------------------------

	if len(poll.Options) < 2 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "At least 2 options are required",
		})
		return
	}

	if len(poll.Options) > 6 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "A maximum of 6 options is allowed",
		})
		return
	}

	cleanedOptions := make([]string, 0, len(poll.Options))

	seenOptions := make(map[string]bool)

	for _, option := range poll.Options {

		option = strings.TrimSpace(option)

		if option == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Options cannot be empty",
			})
			return
		}

		if len(option) > 100 {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Each option must be 100 characters or less",
			})
			return
		}

		optionKey := strings.ToLower(option)

		if seenOptions[optionKey] {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Duplicate options are not allowed",
			})
			return
		}

		seenOptions[optionKey] = true

		cleanedOptions = append(
			cleanedOptions,
			option,
		)
	}

	poll.Options = cleanedOptions

	// -----------------------------------------------
	// GET LOGGED-IN USER
	// -----------------------------------------------

	userIDValue, exists := c.Get("user_id")

	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "User information not found",
		})
		return
	}

	userNameValue, exists := c.Get("name")

	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "User name not found",
		})
		return
	}

	userID, ok := userIDValue.(string)

	if !ok || userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "Invalid user information",
		})
		return
	}

	userName, ok := userNameValue.(string)

	if !ok || userName == "" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "Invalid user name",
		})
		return
	}

	// -----------------------------------------------
	// SAVE CREATOR
	// -----------------------------------------------

	poll.CreatedBy = userID
	poll.CreatorName = userName

	// -----------------------------------------------
	// CREATE POLL ID
	// -----------------------------------------------

	ctx, cancel := context.WithTimeout(
		context.Background(),
		5*time.Second,
	)

	defer cancel()

	count, err := getPollsCollection().
		CountDocuments(
			ctx,
			bson.M{},
		)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to create poll ID",
		})
		return
	}

	poll.ID = int(count) + 1

	// -----------------------------------------------
	// INITIALIZE VOTE COUNTS
	// -----------------------------------------------

	poll.VoteCounts = make(map[string]int)

	for _, option := range poll.Options {
		poll.VoteCounts[option] = 0
	}

	// -----------------------------------------------
	// SAVE POLL TO MONGODB
	// -----------------------------------------------

	_, err = getPollsCollection().
		InsertOne(
			ctx,
			poll,
		)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to create poll",
		})
		return
	}

	// -----------------------------------------------
	// INITIALIZE REDIS LIVE COUNTS
	// -----------------------------------------------

	err = database.InitializePollVotes(
		ctx,
		poll.ID,
		poll.Options,
	)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to initialize live vote counts",
		})
		return
	}

	c.JSON(
		http.StatusCreated,
		poll,
	)
}

// ==================================================
// GET ALL POLLS
// ==================================================

func GetPolls(c *gin.Context) {

	ctx, cancel := context.WithTimeout(
		context.Background(),
		5*time.Second,
	)

	defer cancel()

	cursor, err := getPollsCollection().
		Find(
			ctx,
			bson.M{},
		)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to fetch polls",
		})
		return
	}

	defer cursor.Close(ctx)

	var polls []models.Poll

	if err := cursor.All(
		ctx,
		&polls,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to read polls",
		})
		return
	}

	if polls == nil {
		polls = []models.Poll{}
	}

	// -----------------------------------------------
	// GET LIVE REDIS COUNTS
	// -----------------------------------------------

	for i := range polls {

		liveCounts, err := database.GetPollVoteCounts(
			ctx,
			polls[i].ID,
		)

		if err == nil && len(liveCounts) > 0 {
			polls[i].VoteCounts = liveCounts
		}
	}

	c.JSON(
		http.StatusOK,
		polls,
	)
}

// ==================================================
// GET SINGLE POLL
// ==================================================

func GetPoll(c *gin.Context) {

	id, err := strconv.Atoi(
		c.Param("id"),
	)

	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid poll ID",
		})
		return
	}

	ctx, cancel := context.WithTimeout(
		context.Background(),
		5*time.Second,
	)

	defer cancel()

	var poll models.Poll

	err = getPollsCollection().
		FindOne(
			ctx,
			bson.M{
				"id": id,
			},
		).
		Decode(&poll)

	if err == mongo.ErrNoDocuments {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "Poll not found",
		})
		return
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to fetch poll",
		})
		return
	}

	// -----------------------------------------------
	// GET LIVE REDIS COUNTS
	// -----------------------------------------------

	liveCounts, err := database.GetPollVoteCounts(
		ctx,
		id,
	)

	if err == nil && len(liveCounts) > 0 {
		poll.VoteCounts = liveCounts
	}

	c.JSON(
		http.StatusOK,
		poll,
	)
}

// ==================================================
// VOTE POLL
// ==================================================

func VotePoll(c *gin.Context) {

	id, err := strconv.Atoi(
		c.Param("id"),
	)

	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid poll ID",
		})
		return
	}

	// -----------------------------------------------
	// GET LOGGED-IN USER
	// -----------------------------------------------

	userIDValue, exists := c.Get("user_id")

	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "You must be logged in to vote",
		})
		return
	}

	userID, ok := userIDValue.(string)

	if !ok || userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "Invalid user information",
		})
		return
	}

	// -----------------------------------------------
	// READ REQUEST
	// -----------------------------------------------

	var request struct {
		Option string `json:"option"`
	}

	if err := c.ShouldBindJSON(
		&request,
	); err != nil {

		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid request",
		})

		return
	}

	request.Option = strings.TrimSpace(
		request.Option,
	)

	if request.Option == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Option is required",
		})
		return
	}

	ctx, cancel := context.WithTimeout(
		context.Background(),
		5*time.Second,
	)

	defer cancel()

	// -----------------------------------------------
	// CHECK POLL
	// -----------------------------------------------

	var poll models.Poll

	err = getPollsCollection().
		FindOne(
			ctx,
			bson.M{
				"id": id,
			},
		).
		Decode(&poll)

	if err == mongo.ErrNoDocuments {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "Poll not found",
		})
		return
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to fetch poll",
		})
		return
	}

	// -----------------------------------------------
	// CHECK OPTION
	// -----------------------------------------------

	optionExists := false

	for _, option := range poll.Options {

		if option == request.Option {
			optionExists = true
			break
		}
	}

	if !optionExists {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid option",
		})
		return
	}

	// -----------------------------------------------
	// SAVE USER VOTE TO MONGODB
	// -----------------------------------------------

	vote := models.Vote{
		ID:     bson.NewObjectID(),
		PollID: id,
		UserID: userID,
		Option: request.Option,
	}

	_, err = database.VoteCollection.InsertOne(
		ctx,
		vote,
	)

	if err != nil {

		// MongoDB unique index catches duplicate votes.
		if mongo.IsDuplicateKeyError(err) {

			var existingVote models.Vote

			findErr := database.VoteCollection.
				FindOne(
					ctx,
					bson.M{
						"poll_id": id,
						"user_id": userID,
					},
				).
				Decode(&existingVote)

			if findErr == nil {

				c.JSON(http.StatusConflict, gin.H{
					"error": "You have already voted for \"" +
						existingVote.Option +
						"\"",
					"option": existingVote.Option,
				})

				return
			}

			c.JSON(http.StatusConflict, gin.H{
				"error": "You have already voted in this poll",
			})

			return
		}

		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to record vote",
		})

		return
	}

	// -----------------------------------------------
	// UPDATE LIVE REDIS COUNT
	// -----------------------------------------------

	_, err = database.IncrementPollVote(
		ctx,
		id,
		request.Option,
	)

	if err != nil {

		// Roll back MongoDB vote if Redis fails.
		_, _ = database.VoteCollection.DeleteOne(
			ctx,
			bson.M{
				"_id": vote.ID,
			},
		)

		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to update live vote count",
		})

		return
	}

	// -----------------------------------------------
	// GET LIVE REDIS COUNTS
	// -----------------------------------------------

	liveCounts, err := database.GetPollVoteCounts(
		ctx,
		id,
	)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to fetch live vote counts",
		})
		return
	}

	poll.VoteCounts = liveCounts

	// -----------------------------------------------
	// REDIS PUB/SUB LIVE UPDATE
	// -----------------------------------------------

	pollData, err := json.Marshal(
		poll,
	)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to prepare live update",
		})
		return
	}

	err = database.RedisClient.
		Publish(
			context.Background(),
			"poll_updates",
			pollData,
		).
		Err()

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to publish live update",
		})
		return
	}

	// -----------------------------------------------
	// RESPONSE
	// -----------------------------------------------

	c.JSON(
		http.StatusOK,
		gin.H{
			"message": "Vote recorded successfully",
			"poll":    poll,
		},
	)
}

// ==================================================
// GET POLL RESULTS
// ==================================================

func GetPollResults(c *gin.Context) {

	id, err := strconv.Atoi(
		c.Param("id"),
	)

	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid poll ID",
		})
		return
	}

	ctx, cancel := context.WithTimeout(
		context.Background(),
		5*time.Second,
	)

	defer cancel()

	var poll models.Poll

	err = getPollsCollection().
		FindOne(
			ctx,
			bson.M{
				"id": id,
			},
		).
		Decode(&poll)

	if err == mongo.ErrNoDocuments {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "Poll not found",
		})
		return
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to fetch poll",
		})
		return
	}

	// -----------------------------------------------
	// GET LIVE REDIS COUNTS
	// -----------------------------------------------

	liveCounts, err := database.GetPollVoteCounts(
		ctx,
		id,
	)

	if err == nil && len(liveCounts) > 0 {
		poll.VoteCounts = liveCounts
	}

	// -----------------------------------------------
	// CALCULATE TOTAL VOTES
	// -----------------------------------------------

	totalVotes := 0

	for _, votes := range poll.VoteCounts {
		totalVotes += votes
	}

	// -----------------------------------------------
	// BUILD RESULTS
	// -----------------------------------------------

	results := []gin.H{}

	for _, option := range poll.Options {

		votes := poll.VoteCounts[option]

		percentage := 0.0

		if totalVotes > 0 {
			percentage =
				float64(votes) /
					float64(totalVotes) *
					100
		}

		results = append(
			results,
			gin.H{
				"option":     option,
				"votes":      votes,
				"percentage": percentage,
			},
		)
	}

	// -----------------------------------------------
	// RESPONSE
	// -----------------------------------------------

	c.JSON(
		http.StatusOK,
		gin.H{
			"question":     poll.Question,
			"creator_name": poll.CreatorName,
			"totalVotes":   totalVotes,
			"results":      results,
		},
	)
}
