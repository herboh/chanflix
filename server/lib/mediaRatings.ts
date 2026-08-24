import IMDBRadarrProxy from "@server/api/rating/imdbRadarrProxy";
import type { RTRating } from "@server/api/rating/rottentomatoes";
import RottenTomatoes from "@server/api/rating/rottentomatoes";
import type { RatingResponse } from "@server/api/ratings";
import TheMovieDb from "@server/api/themoviedb";
import logger from "@server/logger";

export type MediaRatingResult = RatingResponse | RTRating;

export const getMediaRatings = async (
  mediaType: "movie" | "tv",
  tmdbId: number
): Promise<MediaRatingResult | undefined> => {
  try {
    const tmdb = new TheMovieDb();
    const rt = new RottenTomatoes();
    if (mediaType === "tv") {
      const show = await tmdb.getTvShow({ tvId: tmdbId });
      return (
        (await rt.getTVRatings(
          show.name,
          show.first_air_date
            ? Number(show.first_air_date.slice(0, 4))
            : undefined
        )) ?? undefined
      );
    }

    const movie = await tmdb.getMovie({ movieId: tmdbId });
    const [rtResult, imdbResult] = await Promise.allSettled([
      rt.getMovieRatings(movie.title, Number(movie.release_date.slice(0, 4))),
      movie.imdb_id
        ? new IMDBRadarrProxy().getMovieRatings(movie.imdb_id)
        : Promise.resolve(undefined),
    ]);
    const rtRating =
      rtResult.status === "fulfilled" ? rtResult.value : undefined;
    const imdbRating =
      imdbResult.status === "fulfilled" ? imdbResult.value : undefined;
    if (!rtRating && !imdbRating) return;
    return {
      ...(rtRating ? { rt: rtRating } : {}),
      ...(imdbRating ? { imdb: imdbRating } : {}),
    };
  } catch (error) {
    logger.debug("Unable to resolve batched media rating", {
      label: "AI Chat",
      mediaType,
      tmdbId,
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
    return;
  }
};
