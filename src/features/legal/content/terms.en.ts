// Copied from docs/legal/terms-of-service-en-draft.md; tests/unit/legal-content.test.ts keeps the two in sync.
import type { LegalDocument } from "./types";

export const termsEn: LegalDocument = {
  effectiveDate: [
    {
      placeholder: "[EFFECTIVE DATE]"
    }
  ],
  intro: [
    {
      type: "p",
      text: [
        "By signing up for or using WorkPulse, you agree to these terms and to the ",
        {
          link: "Privacy Policy",
          href: "/privacy"
        },
        ". If you do not agree, do not use WorkPulse."
      ]
    }
  ],
  sections: [
    {
      id: "section-1",
      heading: "1. About WorkPulse",
      blocks: [
        {
          type: "p",
          text: [
            "WorkPulse is a web app for logging your work, shaping it into achievements, and building a CV from those notes. WorkPulse is run by Ilham Aisy Rasyid (\"we\")."
          ]
        }
      ]
    },
    {
      id: "section-2",
      heading: "2. Pilot status",
      blocks: [
        {
          type: "p",
          text: [
            "WorkPulse is currently running as a free pilot. During the pilot:"
          ]
        },
        {
          type: "ul",
          items: [
            [
              "features may be added, changed, or removed;"
            ],
            [
              "the service may occasionally be unavailable, for example during maintenance;"
            ],
            [
              "we may limit use of certain features, including the number of AI requests per account, so the service keeps running for everyone."
            ]
          ]
        },
        {
          type: "p",
          text: [
            "If paid features are ever introduced, we will announce them first, and you will not be charged unless you choose them yourself. If the pilot ends, we will tell you by email at least ",
            {
              placeholder: "[NUMBER]"
            },
            " days in advance, so you have time to download the CV you need."
          ]
        }
      ]
    },
    {
      id: "section-3",
      heading: "3. Your account",
      blocks: [
        {
          type: "ul",
          items: [
            [
              "One account per person. Use an email address you actually use."
            ],
            [
              "Keep your password secret. All activity in your account is treated as done by you."
            ],
            [
              "If you suspect someone else is using your account, change your password and contact us at ",
              {
                link: "halo@myworkpulse.my.id",
                href: "mailto:halo@myworkpulse.my.id"
              },
              "."
            ],
            [
              "You must be at least ",
              {
                placeholder: "[MINIMUM AGE]"
              },
              " years old."
            ]
          ]
        }
      ]
    },
    {
      id: "section-4",
      heading: "4. Content you store",
      blocks: [
        {
          type: "p",
          text: [
            "All notes, files, and CVs you enter remain yours. You give us a limited permission to store, process, and display them, only as far as needed to run the features you use. That permission ends when your data is deleted as described in the Privacy Policy."
          ]
        },
        {
          type: "p",
          text: [
            "You are responsible for the content you store. Do not store confidential information belonging to your company or other people that you are not allowed to share."
          ]
        }
      ]
    },
    {
      id: "section-5",
      heading: "5. AI suggestions and CV content",
      blocks: [
        {
          type: "ul",
          items: [
            [
              "AI only gives suggestions, and those suggestions can be wrong. Your achievements and CV are your responsibility, so check them before approving them or sending them to anyone."
            ],
            [
              "CV import can also misread data such as company names, job titles, or dates. Check the result before saving it."
            ],
            [
              "WorkPulse does not guarantee that your CV will pass applicant tracking systems (ATS), lead to an interview, or get you hired."
            ]
          ]
        }
      ]
    },
    {
      id: "section-6",
      heading: "6. What you may not do",
      blocks: [
        {
          type: "p",
          text: [
            "When using WorkPulse, you may not:"
          ]
        },
        {
          type: "ul",
          items: [
            [
              "try to open or change another account's data;"
            ],
            [
              "upload malware or files deliberately made to damage the system;"
            ],
            [
              "store content that breaks Indonesian law;"
            ],
            [
              "deliberately overload the service, for example with large volumes of automated requests;"
            ],
            [
              "use AI features for anything other than logging and organising your own career data;"
            ],
            [
              "sell or rent out access to your account."
            ]
          ]
        }
      ]
    },
    {
      id: "section-7",
      heading: "7. Suspension and closing accounts",
      blocks: [
        {
          type: "p",
          text: [
            "You can close your account at any time through account deletion on the Profile and settings page."
          ]
        },
        {
          type: "p",
          text: [
            "We may suspend or close an account that breaks section 6. Unless the breach puts other users or the system at risk, we will tell you by email first and give you a chance to explain."
          ]
        }
      ]
    },
    {
      id: "section-8",
      heading: "8. Service provided as is",
      blocks: [
        {
          type: "p",
          text: [
            "During the pilot, WorkPulse is provided as is. We work to keep your data safe and the service running, but we do not guarantee that the service is always available or free of errors. Keep your own copies of important CVs."
          ]
        }
      ]
    },
    {
      id: "section-9",
      heading: "9. Limitation of liability",
      blocks: [
        {
          type: "p",
          text: [
            {
              placeholder: "[TO BE DRAFTED WITH A LAWYER. Points to cover: liability limits for a free service, data loss, hiring decisions made by third parties, and what cannot be limited under Indonesian law.]"
            }
          ]
        }
      ]
    },
    {
      id: "section-10",
      heading: "10. Governing law",
      blocks: [
        {
          type: "p",
          text: [
            "These terms are governed by the laws of the Republic of Indonesia. If a dispute arises, we want to settle it first through discussion. If it is not settled within ",
            {
              placeholder: "[NUMBER]"
            },
            " days, the dispute will be settled at ",
            {
              placeholder: "[CHOSEN DISTRICT COURT]"
            },
            "."
          ]
        }
      ]
    },
    {
      id: "section-11",
      heading: "11. Changes to these terms",
      blocks: [
        {
          type: "p",
          text: [
            "When these terms change, we update the date at the top. For important changes, we tell you by email or in the app at least ",
            {
              placeholder: "[NUMBER]"
            },
            " days before they take effect. If you keep using WorkPulse after that, you are treated as agreeing to the new terms."
          ]
        }
      ]
    },
    {
      id: "section-12",
      heading: "12. Contact",
      blocks: [
        {
          type: "p",
          text: [
            "Ilham Aisy Rasyid, ",
            {
              link: "halo@myworkpulse.my.id",
              href: "mailto:halo@myworkpulse.my.id"
            },
            "."
          ]
        }
      ]
    }
  ]
};
