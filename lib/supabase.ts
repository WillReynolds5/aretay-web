import type { Curriculum } from "./curriculum";

export type Course = {
  id: string;
  title: string;
  description: string | null;
  cover_image_url: string | null;
  curriculum: Curriculum | null;
  visibility: "private" | "unlisted" | "public";
  is_live: boolean;
  created_at: string;
  deleted_at: string | null;
};
