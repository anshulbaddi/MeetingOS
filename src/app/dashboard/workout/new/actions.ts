"use server";

import { z } from "zod";
import { createWorkout } from "@/data/workouts";

const setSchema = z.object({
  reps: z.coerce.number().int().min(1),
  weight: z.coerce.number().min(0),
  unit: z.enum(["lbs", "kg"]),
});

const exerciseSchema = z.object({
  name: z.string().min(1).max(255),
  sets: z.array(setSchema).min(1),
});

const createWorkoutSchema = z.object({
  startedAt: z.string().datetime(),
  notes: z.string().max(1000).optional(),
  exercises: z.array(exerciseSchema),
});

export type CreateWorkoutParams = z.infer<typeof createWorkoutSchema>;

export async function createWorkoutAction(params: CreateWorkoutParams) {
  const parsed = createWorkoutSchema.safeParse(params);
  if (!parsed.success) throw new Error("Invalid input");

  const { startedAt, notes, exercises } = parsed.data;
  return createWorkout({
    startedAt: new Date(startedAt),
    notes,
    exercises,
  });
}
