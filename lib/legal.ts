// Who stands behind the privacy policy and terms. Set these in the environment once the business details are
// final; each one appears on both legal pages when present, and the pages read correctly without them.

const env = (name: string) => process.env[name]?.trim() || "";

export const LEGAL = {
  /** Registered legal name, e.g. "Reelencer Technologies Private Limited". */
  entity: env("LEGAL_ENTITY_NAME") || "Reelencer",
  /** Registered office address, on one line. */
  address: env("LEGAL_ADDRESS"),
  /** Name of the Grievance Officer under the DPDP Act and IT Rules. */
  grievanceOfficer: env("LEGAL_GRIEVANCE_OFFICER"),
  /** City whose courts hear disputes under the terms, e.g. "Bengaluru". */
  courtCity: env("LEGAL_COURT_CITY"),
  email: "support@reelencer.com",
};

/** How the legal pages name us: "Reelencer (“we”, “us”)", plus the registered name and address once they're set. */
export function legalPartyLabel() {
  const aliases = LEGAL.entity === "Reelencer" ? "“we”, “us”" : "“Reelencer”, “we”, “us”";
  return `${LEGAL.entity}${LEGAL.address ? `, registered at ${LEGAL.address}` : ""} (${aliases})`;
}
