import { useMemo } from "react";
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  Video,
} from "remotion";
import {
  createTikTokStyleCaptions,
  type Caption,
  type TikTokPage,
} from "@remotion/captions";

const SWITCH_CAPTIONS_EVERY_MS = 250;
const HIGHLIGHT_COLOR = "#FFE135";
const INACTIVE_COLOR = "#FFFFFF";

export type LessonVideoProps = {
  videoUrl: string;
  captions: Caption[];
};

function CaptionPage({ page }: { page: TikTokPage }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const absoluteTimeMs = page.startMs + (frame / fps) * 1000;

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: 524,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          fontSize: 88,
          fontWeight: 800,
          textAlign: "center",
          whiteSpace: "pre",
          maxWidth: "92%",
          lineHeight: 1.2,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          textShadow:
            "4px 4px 0 #000, -4px -4px 0 #000, 4px -4px 0 #000, -4px 4px 0 #000, 0 0 16px rgba(0,0,0,0.85)",
        }}
      >
        {page.tokens.map(token => {
          const isActive =
            token.fromMs <= absoluteTimeMs && token.toMs > absoluteTimeMs;
          return (
            <span
              key={token.fromMs}
              style={{ color: isActive ? HIGHLIGHT_COLOR : INACTIVE_COLOR }}
            >
              {token.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

export function LessonVideo({ videoUrl, captions }: LessonVideoProps) {
  const { fps } = useVideoConfig();

  const { pages } = useMemo(
    () =>
      createTikTokStyleCaptions({
        captions,
        combineTokensWithinMilliseconds: SWITCH_CAPTIONS_EVERY_MS,
      }),
    [captions],
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Video
        src={videoUrl}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
      {pages.map(page => (
        <Sequence
          key={page.startMs}
          from={Math.round((page.startMs / 1000) * fps)}
          durationInFrames={Math.max(1, Math.round((page.durationMs / 1000) * fps))}
        >
          <CaptionPage page={page} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
