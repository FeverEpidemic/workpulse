// Copied from docs/legal/privacy-policy-en-draft.md; tests/unit/legal-content.test.ts keeps the two in sync.
import type { LegalDocument } from "./types";

export const privacyEn: LegalDocument = {
  effectiveDate: [
    {
      placeholder: "[EFFECTIVE DATE]"
    }
  ],
  intro: [
    {
      type: "p",
      text: [
        "WorkPulse is a place to log your daily work, shape it into achievements, and use them for your CV. This policy explains what data we store, where it goes, how long we keep it, and what you can do about it."
      ]
    },
    {
      type: "p",
      text: [
        "WorkPulse is currently running as a ",
        {
          strong: "free pilot"
        },
        ". Features and this policy may still change. If something important changes, we will tell you first (see section 11)."
      ]
    }
  ],
  sections: [
    {
      id: "section-1",
      heading: "1. Who runs WorkPulse",
      blocks: [
        {
          type: "p",
          text: [
            "WorkPulse is run by Ilham Aisy Rasyid, ",
            {
              placeholder: "[CITY]"
            },
            ", Indonesia. For questions or requests about your data, contact ",
            {
              link: "halo@myworkpulse.my.id",
              href: "mailto:halo@myworkpulse.my.id"
            },
            "."
          ]
        }
      ]
    },
    {
      id: "section-2",
      heading: "2. Data we store",
      blocks: [
        {
          type: "p",
          text: [
            {
              strong: "Account data."
            },
            " Your email address and password. The authentication service stores your password as a hash, so we cannot read it."
          ]
        },
        {
          type: "p",
          text: [
            {
              strong: "Profile settings."
            },
            " Interface language, time zone, your consent to AI processing with its version and time, and the career profile fields you fill in yourself."
          ]
        },
        {
          type: "p",
          text: [
            {
              strong: "Career records."
            },
            " Everything you enter into WorkPulse: activities, achievements, projects, skills, work experience, education, certifications, and the CV you build."
          ]
        },
        {
          type: "p",
          text: [
            {
              strong: "Files."
            },
            " Evidence files you upload, old CV files you import together with the text read from them, and exported CV PDFs."
          ]
        },
        {
          type: "p",
          text: [
            {
              strong: "Action-type records."
            },
            " WorkPulse records the type of action that happened, such as \"activity saved\" or \"CV export finished\", to measure whether the product works reliably. These records do ",
            {
              strong: "not"
            },
            " contain what you wrote, CV text, file names, file contents, record IDs, or email addresses."
          ]
        },
        {
          type: "p",
          text: [
            "We do not use third-party analytics or advertising tools."
          ]
        }
      ]
    },
    {
      id: "section-3",
      heading: "3. What we use data for",
      blocks: [
        {
          type: "ul",
          items: [
            [
              "Running the features you use: saving notes, building your CV, creating the PDF."
            ],
            [
              "Running AI analysis, only when you have allowed it and asked for it (section 4)."
            ],
            [
              "Checking uploaded files for malware before they can be used."
            ],
            [
              "Measuring product reliability during the pilot from the action-type records in section 2."
            ],
            [
              "Sending the emails your account needs, such as sign-up confirmation and password reset."
            ]
          ]
        },
        {
          type: "p",
          text: [
            "We do not sell your data and do not use it for advertising."
          ]
        }
      ]
    },
    {
      id: "section-4",
      heading: "4. AI processing",
      blocks: [
        {
          type: "p",
          text: [
            "AI in WorkPulse is ",
            {
              strong: "optional"
            },
            ". Every feature still works without AI."
          ]
        },
        {
          type: "p",
          text: [
            "Before you allow AI on the Profile and settings page, no text is sent to an AI provider. After you allow it, text is only sent when you ask for it yourself:"
          ]
        },
        {
          type: "ul",
          items: [
            [
              {
                strong: "Activity analysis:"
              },
              " only the text of the activity note you chose, with its role, scope, and outcome."
            ],
            [
              {
                strong: "CV import:"
              },
              " only the text read from the CV file you uploaded."
            ]
          ]
        },
        {
          type: "p",
          text: [
            "Never sent to an AI provider: evidence files, file names, your name, your email, and your other notes."
          ]
        },
        {
          type: "p",
          text: [
            "AI output is always a suggestion. A suggestion only becomes an achievement after you review and approve it, and your original note is kept exactly as written."
          ]
        },
        {
          type: "p",
          text: [
            "The AI provider we use: ",
            {
              placeholder: "[AI PROVIDER NAME AND COUNTRY]"
            },
            ". The AI provider processes that text on its own servers, and how long it keeps the text follows that provider's policy. We do not promise that the AI provider deletes the text right after processing."
          ]
        },
        {
          type: "p",
          text: [
            "You can withdraw AI consent at any time on the Profile and settings page. Further AI requests stop, and your notes, drafts, and achievements stay as they were. If the AI provider or the scope of data sent changes, we ask for your consent again."
          ]
        }
      ]
    },
    {
      id: "section-5",
      heading: "5. Where data is stored",
      blocks: [
        {
          type: "ul",
          items: [
            [
              {
                strong: "Database, authentication, and files:"
              },
              " Supabase, region ",
              {
                placeholder: "[SUPABASE REGION]"
              },
              "."
            ],
            [
              {
                strong: "Web application, malware scanning, PDF generation, and backups:"
              },
              " servers we manage in ",
              {
                placeholder: "[SERVER LOCATION]"
              },
              "."
            ],
            [
              {
                strong: "Account email:"
              },
              " sent through ",
              {
                placeholder: "[EMAIL PROVIDER]"
              },
              "."
            ],
            [
              {
                strong: "AI processing:"
              },
              " see section 4."
            ]
          ]
        },
        {
          type: "p",
          text: [
            "Each account can only read and change its own data. Files are kept in private storage that cannot be opened through a public link."
          ]
        }
      ]
    },
    {
      id: "section-6",
      heading: "6. How long data is kept",
      blocks: [
        {
          type: "table",
          head: [
            [
              "Data"
            ],
            [
              "Kept for"
            ]
          ],
          rows: [
            [
              [
                "Account and career records"
              ],
              [
                "As long as your account exists"
              ]
            ],
            [
              [
                "Imported CV files and the text read from them"
              ],
              [
                "Deleted within 24 hours after the import finishes, fails, or is cancelled"
              ]
            ],
            [
              [
                "Imports waiting for review that are left untouched"
              ],
              [
                "Cancelled automatically after 30 days, then the file and text are deleted within 24 hours"
              ]
            ],
            [
              [
                "Exported PDFs"
              ],
              [
                "Available to download for 24 hours, then deleted"
              ]
            ],
            [
              [
                "Action-type records"
              ],
              [
                "As long as your account exists. The retention policy will be reviewed after the pilot"
              ]
            ],
            [
              [
                "Database backups"
              ],
              [
                "Made daily, each copy deleted before it is 30 days old"
              ]
            ]
          ]
        }
      ]
    },
    {
      id: "section-7",
      heading: "7. Deleting your account",
      blocks: [
        {
          type: "p",
          text: [
            "You can delete your account yourself on the Profile and settings page. For security, you need to enter your password and retype your account email."
          ]
        },
        {
          type: "p",
          text: [
            "After you confirm:"
          ]
        },
        {
          type: "ul",
          items: [
            [
              "You are signed out on every device right away."
            ],
            [
              "Your profile, activities, achievements, projects, evidence files, imports, CV, exports, and action-type records are deleted within 24 hours."
            ],
            [
              "Backup copies that may still hold your data are deleted within 30 days."
            ]
          ]
        },
        {
          type: "p",
          text: [
            "Deletion cannot be undone, and there is no grace period."
          ]
        }
      ]
    },
    {
      id: "section-8",
      heading: "8. Your rights",
      blocks: [
        {
          type: "p",
          text: [
            "Under Indonesian Law Number 27 of 2022 on Personal Data Protection, you have the right to:"
          ]
        },
        {
          type: "ul",
          items: [
            [
              {
                strong: "see and correct"
              },
              " your data. Most of this can be done directly in the app;"
            ],
            [
              {
                strong: "delete"
              },
              " your data, through account deletion in section 7;"
            ],
            [
              {
                strong: "withdraw consent"
              },
              " to AI processing at any time (section 4);"
            ],
            [
              {
                strong: "request a copy"
              },
              " of your data. There is no button to download all your data at once yet, so send a request to ",
              {
                link: "halo@myworkpulse.my.id",
                href: "mailto:halo@myworkpulse.my.id"
              },
              " and we will reply within ",
              {
                placeholder: "[RESPONSE TIME, e.g. 14 working days]"
              },
              "."
            ]
          ]
        }
      ]
    },
    {
      id: "section-9",
      heading: "9. Cookies",
      blocks: [
        {
          type: "p",
          text: [
            "WorkPulse only uses cookies the app needs:"
          ]
        },
        {
          type: "ul",
          items: [
            [
              "a sign-in session cookie, so you stay signed in;"
            ],
            [
              {
                code: "wp-locale"
              },
              ", to remember the language you chose;"
            ],
            [
              "a theme cookie, to remember your light or dark preference;"
            ],
            [
              {
                code: "wp-recovery-flow"
              },
              ", temporarily while you reset your password."
            ]
          ]
        },
        {
          type: "p",
          text: [
            "There are no advertising cookies or third-party trackers."
          ]
        }
      ]
    },
    {
      id: "section-10",
      heading: "10. Age",
      blocks: [
        {
          type: "p",
          text: [
            "WorkPulse is meant for people who are working or looking for work. You must be at least ",
            {
              placeholder: "[MINIMUM AGE]"
            },
            " years old to sign up."
          ]
        }
      ]
    },
    {
      id: "section-11",
      heading: "11. Changes to this policy",
      blocks: [
        {
          type: "p",
          text: [
            "When this policy changes, we update the date at the top. For changes that affect your data, such as a new provider or a new type of data being sent, we tell you by email or in the app before the change takes effect."
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
