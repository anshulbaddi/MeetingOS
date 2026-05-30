"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updateWorkoutAction } from "./actions";

type SetRow = { reps: string; weight: string; unit: "lbs" | "kg" };
type ExerciseRow = { name: string; sets: SetRow[] };

export type WorkoutForEdit = {
  id: string;
  startedAt: string;
  notes: string | null;
  exercises: {
    name: string;
    sets: { reps: number; weight: number; unit: "lbs" | "kg" }[];
  }[];
};

function emptySet(): SetRow {
  return { reps: "", weight: "", unit: "lbs" };
}

function emptyExercise(): ExerciseRow {
  return { name: "", sets: [emptySet()] };
}

export default function EditWorkoutForm({ workout }: { workout: WorkoutForEdit }) {
  const router = useRouter();
  const [startedAt, setStartedAt] = useState(() => {
    const d = new Date(workout.startedAt);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [notes, setNotes] = useState(workout.notes ?? "");
  const [exercises, setExercises] = useState<ExerciseRow[]>(
    workout.exercises.length > 0
      ? workout.exercises.map((ex) => ({
          name: ex.name,
          sets: ex.sets.map((s) => ({
            reps: String(s.reps),
            weight: String(s.weight),
            unit: s.unit,
          })),
        }))
      : [emptyExercise()],
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateExerciseName(exIdx: number, name: string) {
    setExercises((prev) =>
      prev.map((ex, i) => (i === exIdx ? { ...ex, name } : ex)),
    );
  }

  function updateSet(exIdx: number, setIdx: number, patch: Partial<SetRow>) {
    setExercises((prev) =>
      prev.map((ex, i) =>
        i === exIdx
          ? {
              ...ex,
              sets: ex.sets.map((s, j) =>
                j === setIdx ? { ...s, ...patch } : s,
              ),
            }
          : ex,
      ),
    );
  }

  function addSet(exIdx: number) {
    setExercises((prev) =>
      prev.map((ex, i) =>
        i === exIdx ? { ...ex, sets: [...ex.sets, emptySet()] } : ex,
      ),
    );
  }

  function removeSet(exIdx: number, setIdx: number) {
    setExercises((prev) =>
      prev.map((ex, i) =>
        i === exIdx
          ? { ...ex, sets: ex.sets.filter((_, j) => j !== setIdx) }
          : ex,
      ),
    );
  }

  function addExercise() {
    setExercises((prev) => [...prev, emptyExercise()]);
  }

  function removeExercise(exIdx: number) {
    setExercises((prev) => prev.filter((_, i) => i !== exIdx));
  }

  async function handleSubmit() {
    setError(null);

    for (let i = 0; i < exercises.length; i++) {
      if (!exercises[i].name.trim()) {
        setError(`Exercise ${i + 1} is missing a name.`);
        return;
      }
      for (let j = 0; j < exercises[i].sets.length; j++) {
        const s = exercises[i].sets[j];
        if (!s.reps || isNaN(parseInt(s.reps, 10)) || parseInt(s.reps, 10) < 1) {
          setError(`Exercise ${i + 1}, set ${j + 1} has an invalid rep count.`);
          return;
        }
        if (s.weight === "" || isNaN(parseFloat(s.weight))) {
          setError(`Exercise ${i + 1}, set ${j + 1} has an invalid weight.`);
          return;
        }
      }
    }

    setSubmitting(true);
    try {
      await updateWorkoutAction({
        workoutId: workout.id,
        startedAt: new Date(startedAt).toISOString(),
        notes: notes.trim() || undefined,
        exercises: exercises.map((ex) => ({
          name: ex.name.trim(),
          sets: ex.sets.map((s) => ({
            reps: parseInt(s.reps, 10),
            weight: parseFloat(s.weight),
            unit: s.unit,
          })),
        })),
      });
      router.push("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="startedAt">Date &amp; Time</Label>
        <Input
          id="startedAt"
          type="datetime-local"
          value={startedAt}
          onChange={(e) => setStartedAt(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          placeholder="Optional notes about this session…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
        />
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="text-base font-medium">Exercises</h2>

        {exercises.map((ex, exIdx) => (
          <Card key={exIdx}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-medium">
                  Exercise {exIdx + 1}
                </CardTitle>
                {exercises.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeExercise(exIdx)}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label>Exercise Name</Label>
                <Input
                  placeholder="e.g. Bench Press"
                  value={ex.name}
                  onChange={(e) => updateExerciseName(exIdx, e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-sm text-muted-foreground px-1">
                  <span>Reps</span>
                  <span>Weight</span>
                  <span>Unit</span>
                  <span />
                </div>

                {ex.sets.map((s, setIdx) => (
                  <div
                    key={setIdx}
                    className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center"
                  >
                    <Input
                      type="number"
                      min={1}
                      placeholder="Reps"
                      value={s.reps}
                      onChange={(e) =>
                        updateSet(exIdx, setIdx, { reps: e.target.value })
                      }
                    />
                    <Input
                      type="number"
                      min={0}
                      step="0.5"
                      placeholder="Weight"
                      value={s.weight}
                      onChange={(e) =>
                        updateSet(exIdx, setIdx, { weight: e.target.value })
                      }
                    />
                    <Select
                      value={s.unit}
                      onValueChange={(val) =>
                        updateSet(exIdx, setIdx, { unit: val as "lbs" | "kg" })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="lbs">lbs</SelectItem>
                        <SelectItem value="kg">kg</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={ex.sets.length === 1}
                      onClick={() => removeSet(exIdx, setIdx)}
                    >
                      ✕
                    </Button>
                  </div>
                ))}

                <Button
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() => addSet(exIdx)}
                >
                  Add Set
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}

        <Button variant="outline" onClick={addExercise} className="self-start">
          Add Exercise
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-3">
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting ? "Saving…" : "Save Changes"}
        </Button>
        <Button
          variant="outline"
          onClick={() => router.back()}
          disabled={submitting}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
