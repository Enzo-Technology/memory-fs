// The org gate: the SOLE perimeter for the shared store. Authorization is
// descoped (see CONTEXT.md) — every authenticated member reads/writes everything
// — so the only thing between an outsider and the store is this check on Google's
// verified `hd` (hosted-domain) claim. It is server-side and non-bypassable: the
// `hd` *request* param only filters Google's account chooser; this verifies the
// claim Google actually signed.

export interface GoogleOrgProfile {
  email_verified: boolean;
  hd?: string;
}

// Throws if `profile` is not a verified member of `allowed`. `allowed === "*"` is
// the explicit opt-out for self-hosters who want no domain restriction.
export function assertOrgMember(profile: GoogleOrgProfile, allowed: string): void {
  if (allowed === "*") return;
  // An empty policy is a misconfiguration, not "allow none": crash rather than
  // compare against "" (which an account with hd:"" would satisfy).
  if (allowed === "") {
    throw new Error("org gate: misconfiguration — allowed domain is empty");
  }
  if (!profile.email_verified) {
    throw new Error("org gate: rejected — email not verified");
  }
  // Google emits `hd` lowercased; normalise both sides so a mixed-case config
  // value can't lock everyone out, nor a case-variant slip in.
  if (profile.hd?.toLowerCase() !== allowed.toLowerCase()) {
    throw new Error(`org gate: rejected — hd "${profile.hd ?? ""}" is not "${allowed}"`);
  }
}
