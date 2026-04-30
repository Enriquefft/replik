import "server-only";

/**
 * Owner: Lane L4a (Meta wrapper).
 *
 * Hand-curated, broad interest IDs used by L4b when building `flexible_spec`
 * for an ad set's detailed targeting layer. Sticking to broad LATAM
 * dropshipping verticals on purpose: Meta's discovery API is brittle and we
 * want one stable list per category. Numeric IDs are real Facebook
 * `adinterest` IDs (verifiable via `/search?type=adinterest&q=<name>`).
 */

import type { Interest } from "./types";

export type InterestCategory =
  | "home_garden"
  | "beauty"
  | "fitness"
  | "kitchen"
  | "pets";

export const INTERESTS: Record<InterestCategory, Interest[]> = {
  home_garden: [
    { id: "6003020834693", name: "Home improvement" },
    { id: "6003251053571", name: "Gardening" },
    { id: "6003348604581", name: "Interior design" },
  ],
  beauty: [
    { id: "6003261272525", name: "Cosmetics" },
    { id: "6003277229371", name: "Skin care" },
    { id: "6003456388424", name: "Beauty salons" },
  ],
  fitness: [
    { id: "6003384248805", name: "Physical fitness" },
    { id: "6003235068073", name: "Running" },
    { id: "6003462202852", name: "Yoga" },
  ],
  kitchen: [
    { id: "6003020191065", name: "Cooking" },
    { id: "6003456388421", name: "Kitchen" },
    { id: "6003248338245", name: "Recipes" },
  ],
  pets: [
    { id: "6003123299417", name: "Dogs" },
    { id: "6003028526511", name: "Cats" },
    { id: "6003123461535", name: "Pets" },
  ],
};

export function interestsFor(category: InterestCategory): Interest[] {
  return INTERESTS[category];
}
