import { AbsoluteFill, Sequence, useVideoConfig, interpolate, useCurrentFrame } from "remotion";

export type CourseVideoProps = {
  title: string;
  description: string;
  coverImageUrl: string | null;
};

function TitleCard({ title, description }: { title: string; description: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = interpolate(frame, [0, fps * 0.5], [0, 1], { extrapolateRight: "clamp" });
  const translateY = interpolate(frame, [0, fps * 0.5], [24, 0], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(135deg, #0b0d10 0%, #14181d 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 80,
      }}
    >
      <div
        style={{
          opacity,
          transform: `translateY(${translateY}px)`,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            color: "#e8edf2",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            letterSpacing: "-0.03em",
            lineHeight: 1.1,
            marginBottom: 24,
          }}
        >
          {title}
        </div>
        {description && (
          <div
            style={{
              fontSize: 32,
              color: "#8a95a3",
              fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
              maxWidth: 900,
              lineHeight: 1.4,
            }}
          >
            {description}
          </div>
        )}
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 60,
          right: 80,
          fontSize: 22,
          color: "#6ea8ff",
          fontFamily: "monospace",
          opacity: opacity * 0.7,
        }}
      >
        Aretay
      </div>
    </AbsoluteFill>
  );
}

function OutroCard({ title }: { title: string }) {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();

  const fadeInEnd = fps * 0.4;
  const opacity = interpolate(frame, [0, fadeInEnd], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        background: "#0b0d10",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ opacity, textAlign: "center" }}>
        <div
          style={{
            fontSize: 40,
            color: "#6ea8ff",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            marginBottom: 16,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 24,
            color: "#8a95a3",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          }}
        >
          Start learning today
        </div>
      </div>
    </AbsoluteFill>
  );
}

export function CourseVideo({ title, description, coverImageUrl }: CourseVideoProps) {
  const { fps } = useVideoConfig();

  const titleDuration = fps * 4;
  const outroDuration = fps * 2;

  return (
    <AbsoluteFill style={{ background: "#0b0d10" }}>
      <Sequence from={0} durationInFrames={titleDuration}>
        <TitleCard title={title} description={description ?? ""} />
      </Sequence>
      <Sequence from={titleDuration} durationInFrames={outroDuration}>
        <OutroCard title={title} />
      </Sequence>
    </AbsoluteFill>
  );
}
