"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Course } from "@/lib/supabase";

const VISIBILITY_STYLES: Record<string, string> = {
  private:  "bg-white/5 text-[var(--muted)]",
  unlisted: "bg-yellow-500/10 text-yellow-400",
  public:   "bg-green-500/10 text-green-400",
};

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/courses");
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Failed to load courses");
      else setCourses(data.courses as Course[]);
    } catch {
      setError("Network error while loading courses.");
    }

    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleToggleLive(id: string, isLive: boolean) {
    setCourses(prev => prev.map(c => (c.id === id ? { ...c, is_live: isLive } : c)));
    const res = await fetch(`/api/courses/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_live: isLive }),
    });
    if (!res.ok) load(); // revert the optimistic flip
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this course?")) return;
    await fetch(`/api/courses/${id}`, { method: "DELETE" });
    load();
  }

  function lessonCount(course: Course) {
    const lessons = course.curriculum?.lessons;
    return Array.isArray(lessons) ? lessons.length : 0;
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--background)", color: "var(--foreground)" }}>
      <div className="max-w-5xl mx-auto px-6 py-12">
        <div className="flex items-start justify-between mb-10">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-1">Aretay Admin</h1>
            <p style={{ color: "var(--muted)" }} className="text-sm">Course management · Video studio</p>
          </div>
          <Link
            href="/admin/courses/new"
            className="px-5 py-2 rounded-md text-sm font-semibold"
            style={{ background: "var(--accent)", color: "#0b0d10" }}
          >
            New course
          </Link>
        </div>

        <div className="rounded-xl border" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
          <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "var(--border)" }}>
            <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--muted)" }}>
              All courses
            </h2>
            <button
              onClick={load}
              className="text-xs px-3 py-1.5 rounded-md border"
              style={{ color: "var(--muted)", borderColor: "var(--border)" }}
            >
              ↻ Refresh
            </button>
          </div>

          {loading && (
            <p className="text-center py-10 text-sm" style={{ color: "var(--muted)" }}>Loading…</p>
          )}
          {error && (
            <p className="text-center py-10 text-sm" style={{ color: "#ff6b6b" }}>{error}</p>
          )}
          {!loading && !error && courses.length === 0 && (
            <p className="text-center py-10 text-sm italic" style={{ color: "var(--muted)" }}>No courses yet.</p>
          )}
          {!loading && !error && courses.length > 0 && (
            <div className="overflow-x-auto rounded-b-xl">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                  {["Title", "Description", "Lessons", "Visibility", "Live", "Created", ""].map(h => (
                    <th key={h} className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {courses.map(c => (
                  <tr key={c.id} className="border-b last:border-0 hover:bg-white/[0.02]" style={{ borderColor: "var(--border)" }}>
                    <td className="px-5 py-3 font-medium max-w-[200px] truncate">{c.title}</td>
                    <td className="px-5 py-3 max-w-[200px] truncate" style={{ color: "var(--muted)" }}>
                      {c.description ?? "—"}
                    </td>
                    <td className="px-5 py-3 text-xs" style={{ color: "var(--muted)" }}>
                      {lessonCount(c) > 0 ? lessonCount(c) : "—"}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${VISIBILITY_STYLES[c.visibility]}`}>
                        {c.visibility}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <input
                        type="checkbox"
                        checked={c.is_live}
                        onChange={e => handleToggleLive(c.id, e.target.checked)}
                        className="h-4 w-4 cursor-pointer accent-[var(--accent)]"
                        title={c.is_live ? "Live in the iOS app" : "Hidden from the iOS app"}
                      />
                    </td>
                    <td className="px-5 py-3 text-xs" style={{ color: "var(--muted)" }}>
                      {new Date(c.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/admin/courses/${c.id}`}
                          className="text-xs px-3 py-1.5 rounded-md border font-medium whitespace-nowrap"
                          style={{ color: "var(--accent)", borderColor: "var(--border)" }}
                        >
                          Studio →
                        </Link>
                        <button
                          onClick={() => handleDelete(c.id)}
                          className="text-xs px-3 py-1.5 rounded-md border whitespace-nowrap"
                          style={{ color: "#ff6b6b", borderColor: "var(--border)" }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
