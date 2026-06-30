import { Composition } from "remotion";
import { LessonVideo, type LessonVideoProps } from "./LessonVideo";

const LESSON_FPS = 30;
const LESSON_DURATION_FRAMES = LESSON_FPS * 15;

export function RemotionRoot() {
  return (
    <Composition
      id="LessonVideo"
      component={LessonVideo}
      durationInFrames={LESSON_DURATION_FRAMES}
      fps={LESSON_FPS}
      width={1080}
      height={1920}
      defaultProps={{
        videoUrl: "",
        captions: [],
      } satisfies LessonVideoProps}
    />
  );
}
