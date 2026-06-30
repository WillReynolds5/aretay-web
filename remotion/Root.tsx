import { Composition } from "remotion";
import { CourseVideo, type CourseVideoProps } from "./CourseVideo";
import { LessonVideo, type LessonVideoProps } from "./LessonVideo";

const LESSON_FPS = 30;
const LESSON_DURATION_FRAMES = LESSON_FPS * 15;

export function RemotionRoot() {
  return (
    <>
      <Composition
        id="CourseVideo"
        component={CourseVideo}
        durationInFrames={180}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          title: "My Course",
          description: "A great course about something interesting.",
          coverImageUrl: null,
        } satisfies CourseVideoProps}
      />
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
    </>
  );
}
