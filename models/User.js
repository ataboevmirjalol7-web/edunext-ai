const mongoose = require("mongoose");

const passportItemSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["achievement", "certificate"],
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    issuedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    googleId: {
      type: String,
      trim: true,
    },
    onboarding: {
      learningStyle: {
        type: String,
        enum: ["visual", "audio"],
        required: true,
      },
      stamina: {
        type: Number,
        default: 0,
        min: 0,
      },
      level: {
        type: String,
        enum: ["A1", "A2", "B1", "B2", "C1", "C2"],
        required: true,
      },
    },
    discipline: {
      points: {
        type: Number,
        default: 0,
        min: 0,
      },
      currentStreak: {
        type: Number,
        default: 0,
        min: 0,
      },
      balance: {
        type: Number,
        default: 0,
        min: 0,
      },
    },
    passport: {
      type: [passportItemSchema],
      default: [],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
