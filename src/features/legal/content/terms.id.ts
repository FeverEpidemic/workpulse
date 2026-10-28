// Copied from docs/legal/terms-of-service-id-draft.md; tests/unit/legal-content.test.ts keeps the two in sync.
import type { LegalDocument } from "./types";

export const termsId: LegalDocument = {
  effectiveDate: [
    {
      placeholder: "[TANGGAL BERLAKU]"
    }
  ],
  intro: [
    {
      type: "p",
      text: [
        "Dengan mendaftar atau memakai WorkPulse, Anda setuju dengan syarat ini dan dengan ",
        {
          link: "Kebijakan Privasi",
          href: "/privacy"
        },
        ". Kalau tidak setuju, jangan pakai WorkPulse."
      ]
    }
  ],
  sections: [
    {
      id: "section-1",
      heading: "1. Tentang WorkPulse",
      blocks: [
        {
          type: "p",
          text: [
            "WorkPulse adalah aplikasi web untuk mencatat pekerjaan, menyusunnya menjadi achievement, dan membuat CV dari catatan itu. WorkPulse dikelola oleh Ilham Aisy Rasyid (\"kami\")."
          ]
        }
      ]
    },
    {
      id: "section-2",
      heading: "2. Status pilot",
      blocks: [
        {
          type: "p",
          text: [
            "WorkPulse saat ini berjalan sebagai pilot gratis. Selama pilot:"
          ]
        },
        {
          type: "ul",
          items: [
            [
              "fitur bisa ditambah, diubah, atau dihapus;"
            ],
            [
              "layanan bisa sesekali tidak tersedia, misalnya saat pemeliharaan;"
            ],
            [
              "kami bisa membatasi pemakaian fitur tertentu, termasuk jumlah permintaan AI per akun, supaya layanan tetap jalan untuk semua pengguna."
            ]
          ]
        },
        {
          type: "p",
          text: [
            "Kalau suatu saat ada fitur berbayar, kami umumkan lebih dulu, dan Anda tidak akan ditagih tanpa memilihnya sendiri. Kalau pilot dihentikan, kami beri tahu minimal ",
            {
              placeholder: "[JUMLAH]"
            },
            " hari sebelumnya lewat email, supaya Anda sempat mengunduh CV yang Anda butuhkan."
          ]
        }
      ]
    },
    {
      id: "section-3",
      heading: "3. Akun Anda",
      blocks: [
        {
          type: "ul",
          items: [
            [
              "Satu akun untuk satu orang. Pakai email yang benar-benar Anda gunakan."
            ],
            [
              "Jaga kerahasiaan password Anda. Semua aktivitas di akun Anda dianggap dilakukan oleh Anda."
            ],
            [
              "Kalau Anda curiga akun Anda dipakai orang lain, ganti password dan hubungi kami di ",
              {
                link: "halo@myworkpulse.my.id",
                href: "mailto:halo@myworkpulse.my.id"
              },
              "."
            ],
            [
              "Anda harus berusia minimal ",
              {
                placeholder: "[USIA MINIMUM]"
              },
              " tahun."
            ]
          ]
        }
      ]
    },
    {
      id: "section-4",
      heading: "4. Isi yang Anda simpan",
      blocks: [
        {
          type: "p",
          text: [
            "Semua catatan, file, dan CV yang Anda masukkan tetap milik Anda. Anda memberi kami izin terbatas untuk menyimpan, memproses, dan menampilkannya, hanya sejauh dibutuhkan untuk menjalankan fitur yang Anda pakai. Izin itu berakhir saat data Anda terhapus sesuai Kebijakan Privasi."
          ]
        },
        {
          type: "p",
          text: [
            "Anda bertanggung jawab atas isi yang Anda simpan. Jangan simpan informasi rahasia milik perusahaan atau orang lain yang tidak boleh Anda bagikan."
          ]
        }
      ]
    },
    {
      id: "section-5",
      heading: "5. Usulan AI dan isi CV",
      blocks: [
        {
          type: "ul",
          items: [
            [
              "AI hanya memberi usulan, dan usulan itu bisa keliru. Achievement dan CV Anda adalah tanggung jawab Anda, jadi periksa isinya sebelum disetujui atau dikirim ke siapa pun."
            ],
            [
              "Impor CV juga bisa salah membaca data seperti nama perusahaan, jabatan, atau tanggal. Periksa hasilnya sebelum disimpan."
            ],
            [
              "WorkPulse tidak menjamin CV Anda lolos sistem penyaring lamaran (ATS), dipanggil wawancara, atau diterima kerja."
            ]
          ]
        }
      ]
    },
    {
      id: "section-6",
      heading: "6. Yang tidak boleh dilakukan",
      blocks: [
        {
          type: "p",
          text: [
            "Saat memakai WorkPulse, Anda tidak boleh:"
          ]
        },
        {
          type: "ul",
          items: [
            [
              "mencoba membuka atau mengubah data akun lain;"
            ],
            [
              "mengunggah malware atau file yang sengaja dibuat untuk merusak sistem;"
            ],
            [
              "menyimpan isi yang melanggar hukum Indonesia;"
            ],
            [
              "membebani layanan secara sengaja, misalnya dengan permintaan otomatis dalam jumlah besar;"
            ],
            [
              "memakai fitur AI untuk keperluan di luar mencatat dan menyusun data karier Anda sendiri;"
            ],
            [
              "menjual atau menyewakan akses ke akun Anda."
            ]
          ]
        }
      ]
    },
    {
      id: "section-7",
      heading: "7. Penangguhan dan penutupan akun",
      blocks: [
        {
          type: "p",
          text: [
            "Anda bisa menutup akun kapan saja lewat fitur hapus akun di halaman Profil dan pengaturan."
          ]
        },
        {
          type: "p",
          text: [
            "Kami bisa menangguhkan atau menutup akun yang melanggar bagian 6. Kecuali pelanggarannya membahayakan pengguna lain atau sistem, kami beri tahu dulu lewat email dan beri kesempatan untuk menjelaskan."
          ]
        }
      ]
    },
    {
      id: "section-8",
      heading: "8. Layanan apa adanya",
      blocks: [
        {
          type: "p",
          text: [
            "Selama pilot, WorkPulse disediakan apa adanya. Kami berusaha menjaga data Anda tetap aman dan layanan tetap berjalan, tetapi kami tidak menjamin layanan selalu tersedia atau bebas kesalahan. Simpan salinan CV penting Anda sendiri."
          ]
        }
      ]
    },
    {
      id: "section-9",
      heading: "9. Batas tanggung jawab",
      blocks: [
        {
          type: "p",
          text: [
            {
              placeholder: "[PERLU DIRUMUSKAN BERSAMA AHLI HUKUM. Poin yang perlu dibahas: batas tanggung jawab untuk layanan gratis, kehilangan data, keputusan rekrutmen pihak lain, dan hal yang tidak boleh dibatasi menurut hukum Indonesia.]"
            }
          ]
        }
      ]
    },
    {
      id: "section-10",
      heading: "10. Hukum yang berlaku",
      blocks: [
        {
          type: "p",
          text: [
            "Syarat ini tunduk pada hukum Republik Indonesia. Kalau ada perselisihan, kami ingin menyelesaikannya dulu lewat musyawarah. Kalau tidak selesai dalam ",
            {
              placeholder: "[JUMLAH]"
            },
            " hari, perselisihan diselesaikan di ",
            {
              placeholder: "[PENGADILAN NEGERI YANG DIPILIH]"
            },
            "."
          ]
        }
      ]
    },
    {
      id: "section-11",
      heading: "11. Perubahan syarat",
      blocks: [
        {
          type: "p",
          text: [
            "Kalau syarat ini berubah, kami perbarui tanggal di bagian atas. Untuk perubahan penting, kami beri tahu lewat email atau di dalam aplikasi minimal ",
            {
              placeholder: "[JUMLAH]"
            },
            " hari sebelum berlaku. Kalau Anda terus memakai WorkPulse setelah itu, Anda dianggap setuju dengan syarat yang baru."
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
