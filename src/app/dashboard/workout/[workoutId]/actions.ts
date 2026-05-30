"use server";

import { z } from "zod";
import { updateWorkout } from "@/data/workouts";

const setSchema = z.object({
  reps: z.coerce.number().int().min(1),
  weight: z.coerce.number().min(0),
  unit: z.enum(["lbs", "kg"]),
});

const exerciseSchema = z.object({
  name: z.string().min(1).max(255),
  sets: z.array(setSchema).min(1),
});

const updateWorkoutSchema = z.object({
  workoutId: z.string().uuid(),
  startedAt: z.string().datetime(),
  notes: z.string().max(1000).optional(),
  exercises: z.array(exerciseSchema),
});

export type UpdateWorkoutParams = z.infer<typeof updateWorkoutSchema>;

export async function updateWorkoutAction(params: UpdateWorkoutParams) {
  const parsed = updateWorkoutSchema.safeParse(params);
  if (!parsed.success) throw new Error("Invalid input");

  const { workoutId, startedAt, notes, exercises } = parsed.data;
  await updateWorkout(workoutId, {
    startedAt: new Date(startedAt),
    notes,
    exercises,
  });
}
