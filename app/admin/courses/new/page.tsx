"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Curriculum } from "@/lib/curriculum";
import { flattenScripts } from "@/lib/curriculum";
import type { CurriculumModel } from "@/lib/curriculum-models";
import {
  CURRICULUM_MODEL_LABELS,
  CURRICULUM_MODEL_OPTIONS,
  DEFAULT_CURRICULUM_MODEL,
  isFusionCurriculumModel,
} from "@/lib/curriculum-models";

const inputStyle = {
  background: "var(--background)",
  border: "1px solid var(--border)",
  color: "var(--foreground)",
};

type CreateMode = "scratch" | "cards";

export default function NewCoursePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<CreateMode>("scratch");
  const [cardsText, setCardsText] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [model, setModel] = useState<CurriculumModel>(DEFAULT_CURRICULUM_MODEL);
  const [curriculum, setCurriculum] = useState<Curriculum | null>(null);
  const [generating, setGenerating] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function handleGenerateCourse() {
    if (!name.trim()) {
      setMsg({ text: "Enter a course name first.", ok: false });
      return;
    }
    if (mode === "cards" && !cardsText.trim()) {
      setMsg({ text: "Paste cards before generating from cards.", ok: false });
      return;
    }

    setGenerating(true);
    setMsg(null);
    setCurriculum(null);

    try {
      const genRes = await fetch("/api/generate-curriculum", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          model,
          mode,
          cardsText: mode === "cards" ? cardsText.trim() : undefined,
        }),
      });
      const genData = await genRes.json();

      if (!genRes.ok) {
        setMsg({ text: genData.error ?? "Generation failed", ok: false });
        return;
      }

      const generated = genData.curriculum as Curriculum;
      setCurriculum(generated);

      const createRes = await fetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: name.trim(),
          cover_image_url: coverUrl.trim(),
          curriculum: generated,
        }),
      });
      const createData = await createRes.json();

      if (!createRes.ok) {
        setMsg({ text: createData.error ?? "Failed to save course", ok: false });
        return;
      }

      router.push(`/admin/courses/${createData.id}`);
    } catch {
      setMsg({ text: "Network error while generating course.", ok: false });
    } finally {
      setGenerating(false);
    }
  }

  const previewScripts = curriculum ? flattenScripts(curriculum) : [];

  return (
    <div className="min-h-screen" style={{ background: "var(--background)", color: "var(--foreground)" }}>
      <div className="max-w-2xl mx-auto px-6 py-12">
        <div className="mb-8">
          <Link href="/admin" className="text-xs mb-4 inline-block" style={{ color: "var(--muted)" }}>
            ← All courses
          </Link>
          <h1 className="text-3xl font-bold tracking-tight mb-1">New course</h1>
          <p style={{ color: "var(--muted)" }} className="text-sm">
            Generate a course from a subject, or turn an existing flashcard deck into Aretay lessons.
          </p>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border p-6 space-y-4" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
            <div>
              <label className="block text-xs mb-1.5" style={{ color: "var(--muted)" }}>Create mode</label>
              <select
                value={mode}
                onChange={e => setMode(e.target.value as CreateMode)}
                className="w-full rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1"
                style={inputStyle}
              >
                <option value="scratch">Create from scratch</option>
                <option value="cards">Generate from cards</option>
              </select>
            </div>

            <div>
              <label className="block text-xs mb-1.5" style={{ color: "var(--muted)" }}>Name *</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (!generating) void handleGenerateCourse();
                  }
                }}
                placeholder={mode === "cards" ? "Italian survival phrases" : "ancient greece"}
                required
                className="w-full rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1"
                style={inputStyle}
              />
              <p className="text-xs mt-1.5" style={{ color: "var(--muted)" }}>
                {mode === "cards"
                  ? "Used as the course title while the pasted cards become the review questions."
                  : "A few words or a paragraph — the model infers scope and depth."}
              </p>
            </div>

            {mode === "cards" && (
              <div>
                <label className="block text-xs mb-1.5" style={{ color: "var(--muted)" }}>Cards *</label>
                <textarea
                  value={cardsText}
                  onChange={e => setCardsText(e.target.value)}
                  rows={10}
                  placeholder={"How do you say I would like a coffee in Italian? -> Vorrei un caffè\nWhat does per favore mean? -> Please"}
                  className="w-full rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1"
                  style={inputStyle}
                />
                <p className="text-xs mt-1.5" style={{ color: "var(--muted)" }}>
                  Paste plain text cards. Supported formats include <code>question -&gt; answer</code>, <code>question: answer</code>, tab-separated rows, or numbered lists.
                </p>
              </div>
            )}

            <div>
              <label className="block text-xs mb-1.5" style={{ color: "var(--muted)" }}>Model</label>
              <select
                value={model}
                onChange={e => setModel(e.target.value as CurriculumModel)}
                className="w-full rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1"
                style={inputStyle}
              >
                {CURRICULUM_MODEL_OPTIONS.map(m => (
                  <option key={m} value={m}>{CURRICULUM_MODEL_LABELS[m]}</option>
                ))}
              </select>
              {isFusionCurriculumModel(model) && (
                <p className="text-xs mt-1.5" style={{ color: "var(--muted)" }}>
                  Runs every single-model option in parallel, then a judge synthesizes the final curriculum. Priced as the sum of all panel + judge calls — slower and more expensive, but higher quality.
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs mb-1.5" style={{ color: "var(--muted)" }}>Cover image URL</label>
              <input
                value={coverUrl}
                onChange={e => setCoverUrl(e.target.value)}
                placeholder="https://…"
                className="w-full rounded-md px-3 py-2 text-sm focus:outline-none"
                style={inputStyle}
              />
              {coverUrl && (
                <img
                  src={coverUrl}
                  alt="Cover preview"
                  className="mt-3 rounded-lg max-h-40 object-cover border"
                  style={{ borderColor: "var(--border)" }}
                  onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              )}
            </div>
          </div>

          {curriculum && (
            <div className="rounded-xl border p-4 text-sm" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
              <p className="font-medium mb-0.5">{curriculum.title}</p>
              <p className="text-xs mb-2" style={{ color: "var(--muted)" }}>{curriculum.subtitle}</p>
              <p style={{ color: "var(--muted)" }}>
                {curriculum.lessons.length} lessons · {previewScripts.length} script sections
              </p>
              {curriculum.tags && curriculum.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {curriculum.tags.map(tag => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 rounded-full text-xs border"
                      style={{ borderColor: "var(--border)", color: "var(--muted)" }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={handleGenerateCourse}
              disabled={generating || !name.trim() || (mode === "cards" && !cardsText.trim())}
              className="px-5 py-2 rounded-md text-sm font-semibold disabled:opacity-40"
              style={{ background: "var(--accent)", color: "#0b0d10" }}
            >
              {generating ? "Generating course…" : mode === "cards" ? "Generate from cards" : "Generate course"}
            </button>
            {msg && (
              <span className="text-sm" style={{ color: msg.ok ? "#6fcf97" : "#ff6b6b" }}>
                {msg.text}
              </span>
            )}
          </div>

          {generating && (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Calling {CURRICULUM_MODEL_LABELS[model]}, then saving — this may take a few minutes…
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
