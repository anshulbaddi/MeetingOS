import { integer, pgTable, varchar, timestamp, real, pgEnum, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const weightUnitEnum = pgEnum("weight_unit", ["lbs", "kg"]);

// A single gym session
export const workouts = pgTable("workouts", {
  id: uuid().primaryKey().defaultRandom(),
  userId: varchar({ length: 255 }).notNull(),
  notes: varchar({ length: 1000 }),
  startedAt: timestamp().notNull(),
  completedAt: timestamp(),
  createdAt: timestamp().notNull().defaultNow(),
});

// An exercise performed during a workout (e.g. "Bench Press" as the 2nd exercise)
export const workoutExercises = pgTable("workout_exercises", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  workoutId: uuid().notNull().references(() => workouts.id, { onDelete: "cascade" }),
  name: varchar({ length: 255 }).notNull(),
  orderIndex: integer().notNull(), // order within the workout
});

// An individual set within an exercise (e.g. 3 reps @ 225 lbs)
export const sets = pgTable("sets", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  workoutExerciseId: integer().notNull().references(() => workoutExercises.id, { onDelete: "cascade" }),
  setNumber: integer().notNull(),
  reps: integer().notNull(),
  weight: real().notNull(),
  unit: weightUnitEnum().notNull().default("lbs"),
});

// Relations (used by Drizzle's relational query API)
export const workoutsRelations = relations(workouts, ({ many }) => ({
  workoutExercises: many(workoutExercises),
}));

export const workoutExercisesRelations = relations(workoutExercises, ({ one, many }) => ({
  workout: one(workouts, {
    fields: [workoutExercises.workoutId],
    references: [workouts.id],
  }),
  sets: many(sets),
}));

export const setsRelations = relations(sets, ({ one }) => ({
  workoutExercise: one(workoutExercises, {
    fields: [sets.workoutExerciseId],
    references: [workoutExercises.id],
  }),
}));
