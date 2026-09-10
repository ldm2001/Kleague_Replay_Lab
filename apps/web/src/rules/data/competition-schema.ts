import type { ConceptKey } from "@replay/shared-types";
import type { CompetitionRuleBook } from "../../shared/competition-rules";
import type { StoredCitation } from "./schema";

export type CompetitionRuleBookFile = Omit<CompetitionRuleBook, "cite"> & {
  concepts: Partial<Record<ConceptKey, StoredCitation[]>>;
};
