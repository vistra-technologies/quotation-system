"use client";

import { useState } from "react";
import type { ReactNode } from "react";
// Import order matters for CSS modules: shared brand styles before page modules.
import { BrandLogo } from "@/components/brand/brand-logo";
import { LoginForm } from "./login-form";
import { LoginScene } from "./login-scene";
import page from "./login-page.module.css";
import form from "./login-form.module.css";

interface LoginExperienceProps {
  orgSlug: string;
  /**
   * Replaces the sign-in form (and its subtitle) when set — the cross-org
   * "already signed in" notice. The server page decides; the scene stays.
   */
  notice?: ReactNode;
}

/**
 * Org login page layout (Stage 28 B1): animated scene | auth column | footer.
 *
 * A client component only because the scene reacts to the form (privacy glass
 * while the password field is focused, panes sliding together while submitting)
 * and because the footer's "Support" button and the form's "Contact here"
 * button open the same support popup. page.tsx stays the server shell that
 * decides form vs. cross-org notice and does all the auth/session work.
 */
export function LoginExperience({ orgSlug, notice }: LoginExperienceProps) {
  const [privacyGlass, setPrivacyGlass] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showContact, setShowContact] = useState(false);

  return (
    <div className={page.landing}>
      <LoginScene privacyGlass={privacyGlass} submitting={submitting} />

      <section className={page.auth}>
        <div className={page.authMain}>
          <div className={page.authCol}>
            <div>
              <BrandLogo className={page.authLogo} />
              {!notice && (
                <p className={page.authSub}>Sign in to continue to your account</p>
              )}
            </div>
            {notice ?? (
              <LoginForm
                orgSlug={orgSlug}
                onPasswordFocusChange={setPrivacyGlass}
                onSubmittingChange={setSubmitting}
                onOpenContact={() => setShowContact(true)}
              />
            )}
          </div>
        </div>

        <div className={page.authFoot}>
          <span>© 2026 EaseeTool</span>
          <span>
            <button
              type="button"
              className={page.linkBtn}
              onClick={() => setShowContact(true)}
            >
              Support
            </button>
          </span>
        </div>
      </section>

      {/* ── Support contact popup ── backdrop click or the X closes it. */}
      {showContact && (
        <div
          className={form.scrim}
          data-testid="modal-scrim"
          onClick={() => setShowContact(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="contact-popup-title"
            onClick={(e) => e.stopPropagation()}
            className={form.modal}
          >
            <div className={form.modalHead}>
              <h2 id="contact-popup-title" className={form.modalTitle}>
                Contact support
              </h2>
              <button
                type="button"
                onClick={() => setShowContact(false)}
                aria-label="Close"
                className={form.modalX}
              >
                ✕
              </button>
            </div>
            <div className={form.contactList}>
              <a href="tel:+918149007006">+91 8149007006</a>
              <a href="mailto:support@easeetool.com">support@easeetool.com</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
