// Copied from docs/legal/privacy-policy-id-draft.md; tests/unit/legal-content.test.ts keeps the two in sync.
import type { LegalDocument } from "./types";

export const privacyId: LegalDocument = {
  effectiveDate: [
    {
      placeholder: "[TANGGAL BERLAKU]"
    }
  ],
  intro: [
    {
      type: "p",
      text: [
        "WorkPulse adalah tempat mencatat pekerjaan sehari-hari, menyusunnya menjadi achievement, lalu memakainya untuk CV. Kebijakan ini menjelaskan data apa yang kami simpan, ke mana data itu pergi, berapa lama disimpan, dan apa yang bisa Anda lakukan atasnya."
      ]
    },
    {
      type: "p",
      text: [
        "WorkPulse saat ini berjalan sebagai ",
        {
          strong: "pilot gratis"
        },
        ". Fitur dan kebijakan ini masih bisa berubah. Kalau ada perubahan penting, kami beri tahu lebih dulu (lihat bagian 11)."
      ]
    }
  ],
  sections: [
    {
      id: "section-1",
      heading: "1. Siapa pengelola WorkPulse",
      blocks: [
        {
          type: "p",
          text: [
            "WorkPulse dikelola oleh Ilham Aisy Rasyid, ",
            {
              placeholder: "[KOTA]"
            },
            ", Indonesia. Untuk pertanyaan atau permintaan soal data Anda, hubungi ",
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
      heading: "2. Data yang kami simpan",
      blocks: [
        {
          type: "p",
          text: [
            {
              strong: "Data akun."
            },
            " Alamat email dan password Anda. Password disimpan dalam bentuk hash oleh layanan autentikasi, jadi kami tidak bisa membacanya."
          ]
        },
        {
          type: "p",
          text: [
            {
              strong: "Pengaturan profil."
            },
            " Bahasa antarmuka, zona waktu, persetujuan pemrosesan AI beserta versi dan waktunya, serta isian profil karier yang Anda tulis sendiri."
          ]
        },
        {
          type: "p",
          text: [
            {
              strong: "Catatan karier."
            },
            " Semua yang Anda masukkan ke WorkPulse: activity, achievement, project, skill, pengalaman kerja, pendidikan, sertifikasi, dan CV yang Anda susun."
          ]
        },
        {
          type: "p",
          text: [
            {
              strong: "File."
            },
            " File bukti yang Anda unggah, file CV lama yang Anda impor beserta teks yang dibaca darinya, dan PDF CV hasil export."
          ]
        },
        {
          type: "p",
          text: [
            {
              strong: "Catatan jenis aksi."
            },
            " WorkPulse mencatat jenis aksi yang terjadi, misalnya \"activity disimpan\" atau \"export CV selesai\", untuk mengukur apakah produk bekerja dengan andal. Catatan ini ",
            {
              strong: "tidak"
            },
            " memuat isi tulisan Anda, teks CV, nama file, isi file, ID record, atau email."
          ]
        },
        {
          type: "p",
          text: [
            "Kami tidak memasang alat analitik atau iklan pihak ketiga."
          ]
        }
      ]
    },
    {
      id: "section-3",
      heading: "3. Untuk apa data dipakai",
      blocks: [
        {
          type: "ul",
          items: [
            [
              "Menjalankan fitur yang Anda pakai: menyimpan catatan, menyusun CV, membuat PDF."
            ],
            [
              "Menjalankan analisis AI, hanya kalau Anda sudah mengizinkan dan memintanya (bagian 4)."
            ],
            [
              "Memeriksa file unggahan dari malware sebelum file bisa dipakai."
            ],
            [
              "Mengukur keandalan produk selama pilot dari catatan jenis aksi di bagian 2."
            ],
            [
              "Mengirim email yang dibutuhkan akun, seperti konfirmasi pendaftaran dan reset password."
            ]
          ]
        },
        {
          type: "p",
          text: [
            "Kami tidak menjual data Anda dan tidak memakainya untuk iklan."
          ]
        }
      ]
    },
    {
      id: "section-4",
      heading: "4. Pemrosesan AI",
      blocks: [
        {
          type: "p",
          text: [
            "AI di WorkPulse ",
            {
              strong: "opsional"
            },
            ". Semua fitur tetap bisa dipakai tanpa AI."
          ]
        },
        {
          type: "p",
          text: [
            "Sebelum Anda mengizinkan AI di halaman Profil dan pengaturan, tidak ada teks yang dikirim ke penyedia AI. Setelah diizinkan, teks baru dikirim saat Anda sendiri meminta:"
          ]
        },
        {
          type: "ul",
          items: [
            [
              {
                strong: "Analisis activity:"
              },
              " yang dikirim hanya teks catatan activity yang Anda pilih, beserta peran, cakupan, dan hasilnya."
            ],
            [
              {
                strong: "Impor CV:"
              },
              " yang dikirim hanya teks yang dibaca dari file CV yang Anda unggah."
            ]
          ]
        },
        {
          type: "p",
          text: [
            "Yang tidak pernah dikirim ke penyedia AI: file bukti, nama file, nama Anda, email Anda, dan catatan Anda yang lain."
          ]
        },
        {
          type: "p",
          text: [
            "Hasil AI selalu berupa usulan. Usulan baru menjadi achievement setelah Anda periksa dan setujui, dan catatan asli Anda tetap tersimpan apa adanya."
          ]
        },
        {
          type: "p",
          text: [
            "Penyedia AI yang kami pakai: ",
            {
              placeholder: "[NAMA PENYEDIA AI DAN NEGARANYA]"
            },
            ". Penyedia AI memproses teks itu di servernya sendiri, dan berapa lama mereka menyimpannya mengikuti kebijakan penyedia tersebut. Kami tidak menjanjikan penyedia AI langsung menghapus teks setelah diproses."
          ]
        },
        {
          type: "p",
          text: [
            "Anda bisa menarik persetujuan AI kapan saja di halaman Profil dan pengaturan. Permintaan AI berikutnya berhenti, dan catatan, draf, serta achievement Anda tetap seperti semula. Kalau penyedia AI atau cakupan data yang dikirim berubah, kami minta persetujuan Anda lagi."
          ]
        }
      ]
    },
    {
      id: "section-5",
      heading: "5. Di mana data disimpan",
      blocks: [
        {
          type: "ul",
          items: [
            [
              {
                strong: "Database, autentikasi, dan file:"
              },
              " Supabase, region ",
              {
                placeholder: "[REGION SUPABASE]"
              },
              "."
            ],
            [
              {
                strong: "Aplikasi web, pemeriksaan malware, pembuatan PDF, dan backup:"
              },
              " server yang kami kelola di ",
              {
                placeholder: "[LOKASI SERVER]"
              },
              "."
            ],
            [
              {
                strong: "Email akun:"
              },
              " dikirim lewat ",
              {
                placeholder: "[PENYEDIA EMAIL]"
              },
              "."
            ],
            [
              {
                strong: "Pemrosesan AI:"
              },
              " lihat bagian 4."
            ]
          ]
        },
        {
          type: "p",
          text: [
            "Setiap akun hanya bisa membaca dan mengubah datanya sendiri. File disimpan di penyimpanan privat yang tidak bisa dibuka lewat tautan publik."
          ]
        }
      ]
    },
    {
      id: "section-6",
      heading: "6. Berapa lama data disimpan",
      blocks: [
        {
          type: "table",
          head: [
            [
              "Data"
            ],
            [
              "Lama disimpan"
            ]
          ],
          rows: [
            [
              [
                "Akun dan catatan karier"
              ],
              [
                "Selama akun Anda ada"
              ]
            ],
            [
              [
                "File CV impor dan teks yang dibaca darinya"
              ],
              [
                "Dihapus dalam 24 jam setelah proses impor selesai, gagal, atau dibatalkan"
              ]
            ],
            [
              [
                "Impor yang menunggu review tapi tidak disentuh"
              ],
              [
                "Dibatalkan otomatis setelah 30 hari, lalu file dan teksnya dihapus dalam 24 jam"
              ]
            ],
            [
              [
                "PDF hasil export"
              ],
              [
                "Bisa diunduh selama 24 jam, lalu dihapus"
              ]
            ],
            [
              [
                "Catatan jenis aksi"
              ],
              [
                "Selama akun Anda ada. Kebijakan retensinya akan ditinjau setelah pilot"
              ]
            ],
            [
              [
                "Backup database"
              ],
              [
                "Dibuat harian, setiap salinan dihapus sebelum berumur 30 hari"
              ]
            ]
          ]
        }
      ]
    },
    {
      id: "section-7",
      heading: "7. Menghapus akun",
      blocks: [
        {
          type: "p",
          text: [
            "Anda bisa menghapus akun sendiri di halaman Profil dan pengaturan. Untuk keamanan, Anda perlu memasukkan password dan mengetik ulang email akun."
          ]
        },
        {
          type: "p",
          text: [
            "Setelah Anda konfirmasi:"
          ]
        },
        {
          type: "ul",
          items: [
            [
              "Anda langsung keluar dari semua perangkat."
            ],
            [
              "Profil, activity, achievement, project, file bukti, impor, CV, export, dan catatan jenis aksi dihapus dalam 24 jam."
            ],
            [
              "Salinan backup yang mungkin masih memuat data Anda terhapus dalam 30 hari."
            ]
          ]
        },
        {
          type: "p",
          text: [
            "Penghapusan tidak bisa dibatalkan, dan tidak ada masa tenggang."
          ]
        }
      ]
    },
    {
      id: "section-8",
      heading: "8. Hak Anda",
      blocks: [
        {
          type: "p",
          text: [
            "Sesuai Undang-Undang Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi, Anda berhak:"
          ]
        },
        {
          type: "ul",
          items: [
            [
              {
                strong: "melihat dan memperbaiki"
              },
              " data Anda. Sebagian besar bisa langsung dilakukan di aplikasi;"
            ],
            [
              {
                strong: "menghapus"
              },
              " data Anda, lewat fitur hapus akun di bagian 7;"
            ],
            [
              {
                strong: "menarik persetujuan"
              },
              " pemrosesan AI kapan saja (bagian 4);"
            ],
            [
              {
                strong: "meminta salinan"
              },
              " data Anda. Saat ini belum ada tombol untuk mengunduh semua data sekaligus, jadi kirim permintaan ke ",
              {
                link: "halo@myworkpulse.my.id",
                href: "mailto:halo@myworkpulse.my.id"
              },
              " dan kami jawab dalam ",
              {
                placeholder: "[JANGKA WAKTU, misal 14 hari kerja]"
              },
              "."
            ]
          ]
        }
      ]
    },
    {
      id: "section-9",
      heading: "9. Cookie",
      blocks: [
        {
          type: "p",
          text: [
            "WorkPulse hanya memakai cookie yang dibutuhkan aplikasi:"
          ]
        },
        {
          type: "ul",
          items: [
            [
              "cookie sesi login, supaya Anda tetap masuk;"
            ],
            [
              {
                code: "wp-locale"
              },
              ", untuk mengingat bahasa yang Anda pilih;"
            ],
            [
              "cookie tema, untuk mengingat pilihan tampilan terang atau gelap;"
            ],
            [
              {
                code: "wp-recovery-flow"
              },
              ", sementara saat Anda mereset password."
            ]
          ]
        },
        {
          type: "p",
          text: [
            "Tidak ada cookie iklan atau pelacak pihak ketiga."
          ]
        }
      ]
    },
    {
      id: "section-10",
      heading: "10. Usia",
      blocks: [
        {
          type: "p",
          text: [
            "WorkPulse ditujukan untuk orang yang sedang bekerja atau mencari kerja. Anda harus berusia minimal ",
            {
              placeholder: "[USIA MINIMUM]"
            },
            " tahun untuk mendaftar."
          ]
        }
      ]
    },
    {
      id: "section-11",
      heading: "11. Perubahan kebijakan",
      blocks: [
        {
          type: "p",
          text: [
            "Kalau kebijakan ini berubah, kami perbarui tanggal di bagian atas. Untuk perubahan yang memengaruhi data Anda, misalnya penyedia baru atau jenis data baru yang dikirim, kami beri tahu lewat email atau di dalam aplikasi sebelum perubahan berlaku."
          ]
        }
      ]
    },
    {
      id: "section-12",
      heading: "12. Kontak",
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
