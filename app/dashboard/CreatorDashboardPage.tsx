"use client";
import { apiFetch as fetch } from "@/lib/api/client";
import { useSocialAccounts } from "@/lib/useSocialAccounts";
import { fetchCreatorDashboard, type DashboardWallet } from "@/lib/creatorDashboardClient";
import { bindCreatorCacheIdentity, clearCreatorDeviceCache, creatorCacheIdentity, creatorProfileData, creatorVideoData, CREATOR_CACHE_CLEARED, CREATOR_CACHE_OWNER, dashboardSnapshot, detachCreatorCacheIdentity, isCreatorCacheIdentity, patchCachedDashboard, readCreatorCache, writeCreatorCache, type DashboardSnapshot } from "@/lib/creatorDeviceCache";
import { AccountRecoveryNotice } from "./LinkedAccountRecovery";
import { postingProgress, summarizePayoutBatches } from "@/lib/creatorEarnings";
import { formatAmount as formatINR, formatMoney } from "@/lib/money";

import Link from "next/link";
import { BrandLogo } from "@/app/_components/BrandLogo";
import { useSearchParams } from "next/navigation";
import { dashboardLocation, findGigHref, type DashboardSection } from "@/lib/routes";
import GigDetailPending from "./GigDetailPending";
import GigWorkPanel, { requestGigWorkStart, type WorkAssignment } from "./GigWorkPanel";
import GigBriefAssets from "./GigBriefAssets";
import DashboardJobsView, { type JobPosting } from "./DashboardJobsView";
import AccountSetupPanel from "./AccountSetupPanel";
import AccountSetupCountdown from "./AccountSetupCountdown";
import GigSampleReel from "./GigSampleReel";
import SocialAccountsView from "./SocialAccountsView";
import { parseGigSamples } from "@/lib/gigSamples";
import DashboardOverview from "./DashboardOverview";
import ProfileEditor, { PROFILE_FIELD_IDS } from "./ProfileEditor";
import PlatformGlyph from "./PlatformGlyph";
import { useAccountRequests } from "./AddAccountsPanel";
import { REQUEST_STATUS_LABEL } from "@/lib/accountRequests";
import { formatCompact as formatCompactCount, metricChange } from "@/lib/socialAnalytics";
import DashboardWalletView from "./DashboardWalletView";
import {
  Button as UiButton,
  Card as UiCard,
  CardHeader as UiCardHeader,
  Icon as UiIcon,
  PageHeader,
  StatusBadge,
  JobPayout,
  buttonClassName,
} from "./dashboardUi";
import { createPortal } from "react-dom";
import {
  type ComponentType,
  Fragment,
  useCallback,
  startTransition,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useId,
  useSyncExternalStore,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  type Ref,
  type KeyboardEvent as ReactKeyboardEvent,
  type SVGProps,
} from "react";
import {
  FEEDBACK_CATEGORY_OPTIONS,
  FEEDBACK_MAX_MESSAGE_LENGTH,
  FEEDBACK_MIN_MESSAGE_LENGTH,
  type FeedbackCategory,
} from "@/lib/feedback";
import { ACCOUNT_SETUP_ANCHOR, accountPlatformFor, payoutPhrase, type AccountSetupView } from "@/lib/accountSetup";
import { resolveGigApplicationMode, type GigApplicationMode } from "@/lib/gigApplicationMode";
import { supabase } from "@/lib/supabaseClient";
import { applicationQuota, formatWait, quotaBlocksGig, quotaCoversGig, quotaLimitMessage, strictestQuota, type ApplicationQuota } from "@/lib/applicationQuota";
import WeeklyApplicationsMeter, { ApplicationSlotPreview } from "./WeeklyApplicationsMeter";

type Role = "Admin" | "Worker";
type AuthSession = { role?: Role; workerId?: string; email?: string; name?: string; at?: number | string };

type Gig = {
  id: string;
  title: string;
  company: string;
  verified?: boolean;
  platform: string;
  location: string;
  workload?: string;
  payout: string;
  payoutType?: string;
  gigType?: string;
  requirements: string[];
  applicationMode?: GigApplicationMode;
  status: string;
  postedAt: string;
  browsePinned?: boolean;
  browsePinRank?: number | null;
  browsePinLabel?: string;
  /** Position in the team's feed order (1 = top). */
  feedPosition?: number | null;
};

type ProposalPayload = {
  pitch?: string;
  approach?: string;
  timeline?: string;
  budget?: string;
  portfolio?: string;
  submittedAt?: string;
  reviewStatus?: "Pending" | "Accepted" | "Rejected";
  applicationMode?: "direct_apply" | "proposal";
  source?: string;
  consentAcceptedAt?: string;
  consentText?: string;
  profileSnapshotName?: string;
  profileSnapshotEmail?: string;
  adminNote?: string;
  adminExplanation?: string;
  whatsappLink?: string;
  onboardingSteps?: string;
  groupJoinedConfirmed?: boolean;
  groupJoinedConfirmedAt?: string;
  reviewedAt?: string;
  /** Content Posting gigs: the account the creator set up, verified by a code in its bio (no password). */
  accountSetup?: AccountSetupView;
};

type GigApplication = {
  id: string;
  gigId: string;
  workerId: string;
  status: string;
  appliedAt: string;
  decidedAt?: string;
  workerName?: string;
  workerEmail?: string;
  workerUserId?: string;
  proposal?: ProposalPayload;
};

type GigAssignment = {
  id?: string;
  gigId?: string;
  gig_id?: string;
  status?: string;
  submittedAt?: string;
  submitted_at?: string;
  decidedAt?: string;
  decided_at?: string;
  createdAt?: string;
  created_at?: string;
  assignedEmail?: string;
  assigned_email?: string;
  assignedEmails?: string[];
  earningsReleaseStatus?: "none" | "queued" | "credited" | "blocked";
};

type PayoutItem = {
  id: string;
  amountINR: number;
  status: string;
  handle?: string;
};

type PayoutBatch = {
  id: string;
  cycleLabel: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  createdAt: string;
  processedAt?: string;
  paidAt?: string;
  method: string;
  items: PayoutItem[];
  notes?: string[];
};

type AssignedWorkerAccount = {
  id: string;
  handle: string;
  niche: string;
  ownerTeam: string;
  policyTier: string;
  health: string;
};

type DashboardWorkerProfile = {
  id: string;
  workerId?: string;
  userId?: string;
  name: string;
  email?: string;
  headline?: string;
  city?: string;
  bio?: string;
  active?: boolean;
  assignedAccountIds?: string[];
  assignedAccounts?: AssignedWorkerAccount[];
};

type IntroVideoMeta = {
  name: string;
  uploadedAt: string;
  previewUrl?: string;
  thumbnailUrl?: string;
  path?: string;
  thumbnailPath?: string;
  mimeType?: string;
  size?: number;
};

type DashboardMessage = {
  id: string;
  tone: "blue" | "amber" | "green" | "slate";
  title: string;
  preview: string;
  meta: string;
  detailTitle: string;
  detailBody: string;
  timestamp?: string;
  unread?: boolean;
  important?: boolean;
  status?: string;
  actionLabel: string;
  section: DashboardSection;
  href?: string;
};

type DashboardFeedbackStatus = "new" | "reviewing" | "resolved" | "closed";
type DashboardFeedbackDraft = {
  category: FeedbackCategory;
  rating: number | null;
  message: string;
  allowContact: boolean;
};

type IconProps = SVGProps<SVGSVGElement>;
type LanguageCode = "en" | "fr" | "sl" | "de" | "pl" | "es" | "id" | "bg" | "pt" | "it" | "ar" | "el" | "nl";
type LanguageOption = {
  code: LanguageCode;
  locale: string;
  dir: "ltr" | "rtl";
  flag: string;
  nativeName: string;
  englishName: string;
};
type DashboardStrings = {
  nav: Record<DashboardSection, string>;
  shell: {
    dashboard: string;
    language: string;
    feedback: string;
    syncingData: string;
    liveShellReady: string;
    liveShellDescription: string;
    creator: string;
  };
  home: {
    applications: string;
    viewApplications: string;
    jobsAvailable: string;
    findMoreOpportunities: string;
    opportunityFeedWillAppearHere: string;
    readyToStart: string;
    browseAvailableJobsAndStartApplying: string;
    browseJobs: string;
    openRoles: string;
    unreadUpdates: string;
    pendingPayout: string;
    workflowInMotion: string;
    workflowInMotionDescription: string;
    applicationsInProgress: string;
    applicationsInProgressDescription: string;
    openMessages: string;
    viewJobs: string;
  };
  sectionCopy: Record<DashboardSection, { eyebrow: string; title: string; description: string }>;
};

const AUTH_CACHE_KEY = "igops:auth";
const LOGOUT_MARKER_KEY = "igops:logoutAt";
const LANGUAGE_STORAGE_KEY = "reelencer:dashboard-language";
const INBOX_READ_STORAGE_KEY = "reelencer:inbox-read";
const INBOX_STARRED_STORAGE_KEY = "reelencer:inbox-starred";

type InboxFilter = "all" | "unread" | "starred" | "applications" | "assignments" | "payouts";
type InboxStepState = "done" | "current" | "todo" | "failed";

const INBOX_FILTERS: Array<{ id: InboxFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "starred", label: "Starred" },
  { id: "applications", label: "Applications" },
  { id: "assignments", label: "Assignments" },
  { id: "payouts", label: "Payouts" },
];
const GIGS_CACHE_KEY = "reelencer:dashboard-gigs";
const GIG_APPLICATIONS_CACHE_KEY = "igops:gig-apps";
const GIGS_CACHE_TTL_MS = 1000 * 60 * 15;
const DIRECT_APPLY_CONSENT_TEXT =
  "I understand that recruiter screening, campaign instructions, and brand-specific operating guidelines for this role will be managed through Reelencer after submission.";

const NAV_ITEMS = [
  { id: "jobs", icon: JobsIcon },
  { id: "dashboard", icon: DashboardIcon },
  { id: "find", icon: SearchIcon },
  { id: "accounts", icon: AccountsIcon },
  { id: "messages", icon: MessagesIcon },
  { id: "wallet", icon: WalletIcon },
] as const;

// Presentation (intro) video is paused for now: hidden from the profile and not counted toward readiness.
// The upload flow and stored videos are untouched; set to true to bring it back.
const PRESENTATION_VIDEO_ENABLED = false;


const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: "en", locale: "en-US", dir: "ltr", flag: "🇬🇧", nativeName: "English", englishName: "English" },
  { code: "fr", locale: "fr-FR", dir: "ltr", flag: "🇫🇷", nativeName: "Français", englishName: "French" },
  { code: "sl", locale: "sl-SI", dir: "ltr", flag: "🇸🇮", nativeName: "Slovenščina", englishName: "Slovene" },
  { code: "de", locale: "de-DE", dir: "ltr", flag: "🇩🇪", nativeName: "Deutsch", englishName: "German" },
  { code: "pl", locale: "pl-PL", dir: "ltr", flag: "🇵🇱", nativeName: "Polski", englishName: "Polish" },
  { code: "es", locale: "es-ES", dir: "ltr", flag: "🇪🇸", nativeName: "Español", englishName: "Spanish" },
  { code: "id", locale: "id-ID", dir: "ltr", flag: "🇮🇩", nativeName: "Bahasa Indonesia", englishName: "Indonesian" },
  { code: "bg", locale: "bg-BG", dir: "ltr", flag: "🇧🇬", nativeName: "Български", englishName: "Bulgarian" },
  { code: "pt", locale: "pt-PT", dir: "ltr", flag: "🇵🇹", nativeName: "Português", englishName: "Portuguese" },
  { code: "it", locale: "it-IT", dir: "ltr", flag: "🇮🇹", nativeName: "Italiano", englishName: "Italian" },
  { code: "ar", locale: "ar-AE", dir: "rtl", flag: "🇦🇪", nativeName: "العربية", englishName: "Arabic" },
  { code: "el", locale: "el-GR", dir: "ltr", flag: "🇬🇷", nativeName: "Ελληνικά", englishName: "Greek" },
  { code: "nl", locale: "nl-NL", dir: "ltr", flag: "🇳🇱", nativeName: "Nederlands", englishName: "Dutch" },
];

const SECTION_COPY: Record<DashboardSection, { eyebrow: string; title: string; description: string }> = {
  profile: {
    eyebrow: "Profile",
    title: "Your profile",
    description: "Manage your profile, media, and account readiness in one place.",
  },
  dashboard: {
    eyebrow: "Overview",
    title: "Your creator dashboard",
    description: "Find your next opportunity, track your work, and manage your earnings.",
  },
  jobs: {
    eyebrow: "Jobs board",
    title: "Your jobs",
    description: "Track every gig from application to approval and payout.",
  },
  find: {
    eyebrow: "Discovery",
    title: "Find gigs",
    description: "Search by brand, platform, or region, then apply in a few taps.",
  },
  accounts: {
    eyebrow: "Linked accounts",
    title: "Your accounts",
    description: "Followers, reach and reel results for the accounts you post on for gigs.",
  },
  messages: {
    eyebrow: "Inbox",
    title: "Messages",
    description: "Stay up to date on your applications, assignments, and payouts.",
  },
  wallet: {
    eyebrow: "Payouts",
    title: "Wallet",
    description: "See what you've earned, what's still pending, and where each payout stands.",
  },
};

const UI_STRINGS: Record<LanguageCode, DashboardStrings> = {
  en: {
    nav: { profile: "Profile", dashboard: "Dashboard", jobs: "Jobs", find: "Find gigs", accounts: "Linked", messages: "Messages", wallet: "Wallet" },
    shell: {
      dashboard: "Dashboard",
      language: "Language",
      feedback: "Feedback",
      syncingData: "Syncing data",
      liveShellReady: "Your workspace is ready",
      liveShellDescription: "Discover gigs, manage assignments, and track your earnings in one place.",
      creator: "Creator",
    },
    home: {
      applications: "applications",
      viewApplications: "View your applications",
      jobsAvailable: "Jobs available",
      findMoreOpportunities: "Find more opportunities",
      opportunityFeedWillAppearHere: "Opportunity feed will appear here",
      readyToStart: "Ready to start?",
      browseAvailableJobsAndStartApplying: "Browse active opportunities and start applying.",
      browseJobs: "Browse jobs",
      openRoles: "Open roles",
      unreadUpdates: "Unread updates",
      pendingPayout: "Pending payout",
      workflowInMotion: "Your pipeline is moving",
      workflowInMotionDescription: "You have {assignmentsLabel} and {applicationsLabel} in progress.",
      applicationsInProgress: "Applications in progress",
      applicationsInProgressDescription: "Review recruiter updates and discover more creator opportunities from the same workspace.",
      openMessages: "Open Messages",
      viewJobs: "View Jobs",
    },
    sectionCopy: SECTION_COPY,
  },
  fr: {
    nav: { profile: "Profil", dashboard: "Tableau de bord", jobs: "Offres", find: "Recherche", accounts: "Comptes", messages: "Messages", wallet: "Portefeuille" },
    shell: {
      dashboard: "Tableau de bord",
      language: "Langue",
      feedback: "Retour",
      syncingData: "Synchronisation",
      liveShellReady: "Espace prêt",
      liveShellDescription: "Le tableau de bord garde la mise en page de référence et ouvre les vues offres, recherche, messages et paiements.",
      creator: "Créateur",
    },
    home: {
      applications: "candidatures",
      viewApplications: "Voir vos candidatures",
      jobsAvailable: "Offres disponibles",
      findMoreOpportunities: "Trouver plus d'opportunités",
      opportunityFeedWillAppearHere: "Le flux d'opportunités apparaîtra ici",
      readyToStart: "Prêt à commencer ?",
      browseAvailableJobsAndStartApplying: "Parcourez les offres disponibles et commencez à postuler",
      browseJobs: "Voir les offres",
      openRoles: "Postes ouverts",
      unreadUpdates: "Mises à jour non lues",
      pendingPayout: "Paiement en attente",
      workflowInMotion: "Flux en cours",
      workflowInMotionDescription: "{assignments} missions et {applications} candidatures sont déjà suivies ici.",
      applicationsInProgress: "Candidatures en cours",
      applicationsInProgressDescription: "Continuez à suivre votre file et découvrez d'autres offres depuis le même tableau de bord.",
      openMessages: "Ouvrir les messages",
      viewJobs: "Voir les offres",
    },
    sectionCopy: SECTION_COPY,
  },
  sl: {
    nav: { profile: "Profil", dashboard: "Nadzorna plošča", jobs: "Dela", find: "Iskanje", accounts: "Računi", messages: "Sporočila", wallet: "Denarnica" },
    shell: {
      dashboard: "Nadzorna plošča",
      language: "Jezik",
      feedback: "Povratne informacije",
      syncingData: "Sinhronizacija",
      liveShellReady: "Sistem pripravljen",
      liveShellDescription: "Nadzorna plošča ohrani referenčno postavitev in spodaj odpre poglede za dela, iskanje, sporočila in denarnico.",
      creator: "Ustvarjalec",
    },
    home: {
      applications: "prijave",
      viewApplications: "Poglejte svoje prijave",
      jobsAvailable: "Razpoložljiva dela",
      findMoreOpportunities: "Poiščite več priložnosti",
      opportunityFeedWillAppearHere: "Vir priložnosti se bo prikazal tukaj",
      readyToStart: "Pripravljeni za začetek?",
      browseAvailableJobsAndStartApplying: "Prebrskajte razpoložljiva dela in začnite s prijavo",
      browseJobs: "Prebrskaj dela",
      openRoles: "Odprte vloge",
      unreadUpdates: "Neprebrana obvestila",
      pendingPayout: "Čakajoče izplačilo",
      workflowInMotion: "Potek v teku",
      workflowInMotionDescription: "Tukaj je že spremljanih {assignments} nalog in {applications} prijav.",
      applicationsInProgress: "Prijave v teku",
      applicationsInProgressDescription: "Pregledujte svojo vrsto in odkrijte več odprtih vlog v isti nadzorni plošči.",
      openMessages: "Odpri sporočila",
      viewJobs: "Poglej dela",
    },
    sectionCopy: SECTION_COPY,
  },
  de: {
    nav: { profile: "Profil", dashboard: "Dashboard", jobs: "Jobs", find: "Suche", accounts: "Konten", messages: "Nachrichten", wallet: "Wallet" },
    shell: {
      dashboard: "Dashboard",
      language: "Sprache",
      feedback: "Feedback",
      syncingData: "Synchronisiert",
      liveShellReady: "System bereit",
      liveShellDescription: "Das Dashboard behält das Referenzlayout bei und öffnet darunter Jobs, Suche, Nachrichten und Wallet.",
      creator: "Creator",
    },
    home: {
      applications: "Bewerbungen",
      viewApplications: "Deine Bewerbungen ansehen",
      jobsAvailable: "Verfügbare Jobs",
      findMoreOpportunities: "Mehr Möglichkeiten finden",
      opportunityFeedWillAppearHere: "Der Chancen-Feed erscheint hier",
      readyToStart: "Bereit zu starten?",
      browseAvailableJobsAndStartApplying: "Verfügbare Jobs durchsuchen und direkt bewerben",
      browseJobs: "Jobs durchsuchen",
      openRoles: "Offene Rollen",
      unreadUpdates: "Ungelesene Updates",
      pendingPayout: "Ausstehende Auszahlung",
      workflowInMotion: "Workflow läuft",
      workflowInMotionDescription: "{assignments} Aufgaben und {applications} Bewerbungen werden hier bereits verfolgt.",
      applicationsInProgress: "Bewerbungen in Bearbeitung",
      applicationsInProgressDescription: "Behalte deine Warteschlange im Blick und entdecke weitere offene Rollen im selben Dashboard.",
      openMessages: "Nachrichten öffnen",
      viewJobs: "Jobs ansehen",
    },
    sectionCopy: SECTION_COPY,
  },
  pl: {
    nav: { profile: "Profil", dashboard: "Panel", jobs: "Oferty", find: "Szukaj", accounts: "Konta", messages: "Wiadomości", wallet: "Portfel" },
    shell: {
      dashboard: "Panel",
      language: "Język",
      feedback: "Opinie",
      syncingData: "Synchronizacja",
      liveShellReady: "System gotowy",
      liveShellDescription: "Panel zachowuje układ referencyjny i pod spodem otwiera widoki ofert, wyszukiwania, wiadomości i portfela.",
      creator: "Twórca",
    },
    home: {
      applications: "zgłoszenia",
      viewApplications: "Zobacz swoje zgłoszenia",
      jobsAvailable: "Dostępne oferty",
      findMoreOpportunities: "Znajdź więcej możliwości",
      opportunityFeedWillAppearHere: "Kanał ofert pojawi się tutaj",
      readyToStart: "Gotowy, aby zacząć?",
      browseAvailableJobsAndStartApplying: "Przeglądaj dostępne oferty i zacznij aplikować",
      browseJobs: "Przeglądaj oferty",
      openRoles: "Otwarte role",
      unreadUpdates: "Nieprzeczytane aktualizacje",
      pendingPayout: "Oczekująca wypłata",
      workflowInMotion: "Praca w toku",
      workflowInMotionDescription: "Tutaj śledzonych jest już {assignments} zadań i {applications} zgłoszeń.",
      applicationsInProgress: "Zgłoszenia w toku",
      applicationsInProgressDescription: "Kontroluj swoją kolejkę i odkrywaj więcej otwartych ról z tego samego panelu.",
      openMessages: "Otwórz wiadomości",
      viewJobs: "Zobacz oferty",
    },
    sectionCopy: SECTION_COPY,
  },
  es: {
    nav: { profile: "Perfil", dashboard: "Panel", jobs: "Trabajos", find: "Buscar", accounts: "Cuentas", messages: "Mensajes", wallet: "Cartera" },
    shell: {
      dashboard: "Panel",
      language: "Idioma",
      feedback: "Comentarios",
      syncingData: "Sincronizando",
      liveShellReady: "Sistema listo",
      liveShellDescription: "El panel mantiene el diseño de referencia y abre debajo vistas de trabajos, búsqueda, mensajes y cartera.",
      creator: "Creador",
    },
    home: {
      applications: "solicitudes",
      viewApplications: "Ver tus solicitudes",
      jobsAvailable: "Trabajos disponibles",
      findMoreOpportunities: "Encuentra más oportunidades",
      opportunityFeedWillAppearHere: "El feed de oportunidades aparecerá aquí",
      readyToStart: "¿Listo para empezar?",
      browseAvailableJobsAndStartApplying: "Explora trabajos disponibles y empieza a postular",
      browseJobs: "Explorar trabajos",
      openRoles: "Roles abiertos",
      unreadUpdates: "Actualizaciones sin leer",
      pendingPayout: "Pago pendiente",
      workflowInMotion: "Flujo en marcha",
      workflowInMotionDescription: "Aquí ya se están siguiendo {assignments} tareas y {applications} solicitudes.",
      applicationsInProgress: "Solicitudes en progreso",
      applicationsInProgressDescription: "Sigue revisando tu cola y descubre más roles abiertos desde el mismo panel.",
      openMessages: "Abrir mensajes",
      viewJobs: "Ver trabajos",
    },
    sectionCopy: SECTION_COPY,
  },
  id: {
    nav: { profile: "Profil", dashboard: "Dasbor", jobs: "Pekerjaan", find: "Cari", accounts: "Akun", messages: "Pesan", wallet: "Dompet" },
    shell: {
      dashboard: "Dasbor",
      language: "Bahasa",
      feedback: "Masukan",
      syncingData: "Menyinkronkan",
      liveShellReady: "Sistem siap",
      liveShellDescription: "Dasbor mempertahankan tata letak referensi dan membuka tampilan pekerjaan, pencarian, pesan, dan dompet di bawahnya.",
      creator: "Kreator",
    },
    home: {
      applications: "lamaran",
      viewApplications: "Lihat lamaran Anda",
      jobsAvailable: "Pekerjaan tersedia",
      findMoreOpportunities: "Temukan lebih banyak peluang",
      opportunityFeedWillAppearHere: "Umpan peluang akan muncul di sini",
      readyToStart: "Siap memulai?",
      browseAvailableJobsAndStartApplying: "Telusuri pekerjaan yang tersedia dan mulai melamar",
      browseJobs: "Telusuri pekerjaan",
      openRoles: "Peran terbuka",
      unreadUpdates: "Pembaruan belum dibaca",
      pendingPayout: "Pembayaran tertunda",
      workflowInMotion: "Alur berjalan",
      workflowInMotionDescription: "{assignments} tugas dan {applications} lamaran sudah dilacak di sini.",
      applicationsInProgress: "Lamaran sedang berjalan",
      applicationsInProgressDescription: "Terus tinjau antrean Anda dan temukan lebih banyak peran terbuka dari dasbor yang sama.",
      openMessages: "Buka pesan",
      viewJobs: "Lihat pekerjaan",
    },
    sectionCopy: SECTION_COPY,
  },
  bg: {
    nav: { profile: "Профил", dashboard: "Табло", jobs: "Работи", find: "Търсене", accounts: "Акаунти", messages: "Съобщения", wallet: "Портфейл" },
    shell: {
      dashboard: "Табло",
      language: "Език",
      feedback: "Обратна връзка",
      syncingData: "Синхронизиране",
      liveShellReady: "Системата е готова",
      liveShellDescription: "Таблото запазва референтния изглед и отваря секции за работи, търсене, съобщения и портфейл.",
      creator: "Създател",
    },
    home: {
      applications: "кандидатури",
      viewApplications: "Вижте вашите кандидатури",
      jobsAvailable: "Налични работи",
      findMoreOpportunities: "Намерете повече възможности",
      opportunityFeedWillAppearHere: "Потокът с възможности ще се появи тук",
      readyToStart: "Готови ли сте да започнете?",
      browseAvailableJobsAndStartApplying: "Разгледайте наличните работи и започнете да кандидатствате",
      browseJobs: "Разгледай работи",
      openRoles: "Отворени роли",
      unreadUpdates: "Непрочетени известия",
      pendingPayout: "Чакащо плащане",
      workflowInMotion: "Работен поток в ход",
      workflowInMotionDescription: "Тук вече се проследяват {assignments} задачи и {applications} кандидатури.",
      applicationsInProgress: "Кандидатури в процес",
      applicationsInProgressDescription: "Следете опашката си и открийте още отворени роли от същото табло.",
      openMessages: "Отвори съобщения",
      viewJobs: "Виж работи",
    },
    sectionCopy: SECTION_COPY,
  },
  pt: {
    nav: { profile: "Perfil", dashboard: "Painel", jobs: "Vagas", find: "Pesquisar", accounts: "Contas", messages: "Mensagens", wallet: "Carteira" },
    shell: {
      dashboard: "Painel",
      language: "Idioma",
      feedback: "Feedback",
      syncingData: "A sincronizar",
      liveShellReady: "Sistema pronto",
      liveShellDescription: "O painel mantém a estrutura de referência e abre abaixo vistas de vagas, pesquisa, mensagens e carteira.",
      creator: "Criador",
    },
    home: {
      applications: "candidaturas",
      viewApplications: "Ver as suas candidaturas",
      jobsAvailable: "Vagas disponíveis",
      findMoreOpportunities: "Encontrar mais oportunidades",
      opportunityFeedWillAppearHere: "O feed de oportunidades aparecerá aqui",
      readyToStart: "Pronto para começar?",
      browseAvailableJobsAndStartApplying: "Explore vagas disponíveis e comece a candidatar-se",
      browseJobs: "Explorar vagas",
      openRoles: "Funções abertas",
      unreadUpdates: "Atualizações por ler",
      pendingPayout: "Pagamento pendente",
      workflowInMotion: "Fluxo em movimento",
      workflowInMotionDescription: "Já estão a ser acompanhadas aqui {assignments} tarefas e {applications} candidaturas.",
      applicationsInProgress: "Candidaturas em curso",
      applicationsInProgressDescription: "Continue a rever a sua fila e descubra mais funções abertas no mesmo painel.",
      openMessages: "Abrir mensagens",
      viewJobs: "Ver vagas",
    },
    sectionCopy: SECTION_COPY,
  },
  it: {
    nav: { profile: "Profilo", dashboard: "Dashboard", jobs: "Lavori", find: "Cerca", accounts: "Account", messages: "Messaggi", wallet: "Portafoglio" },
    shell: {
      dashboard: "Dashboard",
      language: "Lingua",
      feedback: "Feedback",
      syncingData: "Sincronizzazione",
      liveShellReady: "Sistema pronto",
      liveShellDescription: "La dashboard mantiene il layout di riferimento e apre sotto viste per lavori, ricerca, messaggi e portafoglio.",
      creator: "Creator",
    },
    home: {
      applications: "candidature",
      viewApplications: "Visualizza le tue candidature",
      jobsAvailable: "Lavori disponibili",
      findMoreOpportunities: "Trova più opportunità",
      opportunityFeedWillAppearHere: "Il feed delle opportunità apparirà qui",
      readyToStart: "Pronto a iniziare?",
      browseAvailableJobsAndStartApplying: "Esplora i lavori disponibili e inizia a candidarti",
      browseJobs: "Esplora lavori",
      openRoles: "Ruoli aperti",
      unreadUpdates: "Aggiornamenti non letti",
      pendingPayout: "Pagamento in sospeso",
      workflowInMotion: "Flusso in corso",
      workflowInMotionDescription: "Qui sono già monitorati {assignments} incarichi e {applications} candidature.",
      applicationsInProgress: "Candidature in corso",
      applicationsInProgressDescription: "Continua a controllare la tua coda e scopri altri ruoli aperti dalla stessa dashboard.",
      openMessages: "Apri messaggi",
      viewJobs: "Vedi lavori",
    },
    sectionCopy: SECTION_COPY,
  },
  ar: {
    nav: { profile: "الملف الشخصي", dashboard: "لوحة التحكم", jobs: "الوظائف", find: "بحث", accounts: "الحسابات", messages: "الرسائل", wallet: "المحفظة" },
    shell: {
      dashboard: "لوحة التحكم",
      language: "اللغة",
      feedback: "ملاحظات",
      syncingData: "جارِ المزامنة",
      liveShellReady: "النظام جاهز",
      liveShellDescription: "تحافظ لوحة التحكم على التصميم المرجعي وتفتح أسفلها أقسام الوظائف والبحث والرسائل والمحفظة.",
      creator: "منشئ",
    },
    home: {
      applications: "طلبات",
      viewApplications: "عرض طلباتك",
      jobsAvailable: "الوظائف المتاحة",
      findMoreOpportunities: "اعثر على فرص أكثر",
      opportunityFeedWillAppearHere: "سيظهر تدفق الفرص هنا",
      readyToStart: "هل أنت مستعد للبدء؟",
      browseAvailableJobsAndStartApplying: "تصفح الوظائف المتاحة وابدأ بالتقديم",
      browseJobs: "تصفح الوظائف",
      openRoles: "الأدوار المفتوحة",
      unreadUpdates: "التحديثات غير المقروءة",
      pendingPayout: "دفعة معلقة",
      workflowInMotion: "سير العمل مستمر",
      workflowInMotionDescription: "يتم هنا بالفعل تتبع {assignments} مهام و{applications} طلبات.",
      applicationsInProgress: "طلبات قيد التقدم",
      applicationsInProgressDescription: "واصل مراجعة قائمتك واكتشف المزيد من الأدوار المفتوحة من لوحة التحكم نفسها.",
      openMessages: "فتح الرسائل",
      viewJobs: "عرض الوظائف",
    },
    sectionCopy: SECTION_COPY,
  },
  el: {
    nav: { profile: "Προφίλ", dashboard: "Πίνακας", jobs: "Θέσεις", find: "Αναζήτηση", accounts: "Λογαριασμοί", messages: "Μηνύματα", wallet: "Πορτοφόλι" },
    shell: {
      dashboard: "Πίνακας",
      language: "Γλώσσα",
      feedback: "Σχόλια",
      syncingData: "Συγχρονισμός",
      liveShellReady: "Το σύστημα είναι έτοιμο",
      liveShellDescription: "Ο πίνακας κρατά τη βασική διάταξη και ανοίγει κάτω ενότητες για θέσεις, αναζήτηση, μηνύματα και πορτοφόλι.",
      creator: "Δημιουργός",
    },
    home: {
      applications: "αιτήσεις",
      viewApplications: "Δείτε τις αιτήσεις σας",
      jobsAvailable: "Διαθέσιμες θέσεις",
      findMoreOpportunities: "Βρείτε περισσότερες ευκαιρίες",
      opportunityFeedWillAppearHere: "Η ροή ευκαιριών θα εμφανιστεί εδώ",
      readyToStart: "Έτοιμοι να ξεκινήσετε;",
      browseAvailableJobsAndStartApplying: "Περιηγηθείτε σε διαθέσιμες θέσεις και ξεκινήστε αιτήσεις",
      browseJobs: "Περιήγηση θέσεων",
      openRoles: "Ανοιχτοί ρόλοι",
      unreadUpdates: "Μη αναγνωσμένες ενημερώσεις",
      pendingPayout: "Εκκρεμής πληρωμή",
      workflowInMotion: "Ροή σε εξέλιξη",
      workflowInMotionDescription: "Εδώ παρακολουθούνται ήδη {assignments} εργασίες και {applications} αιτήσεις.",
      applicationsInProgress: "Αιτήσεις σε εξέλιξη",
      applicationsInProgressDescription: "Συνεχίστε να παρακολουθείτε την ουρά σας και ανακαλύψτε περισσότερους ανοιχτούς ρόλους από τον ίδιο πίνακα.",
      openMessages: "Άνοιγμα μηνυμάτων",
      viewJobs: "Δείτε θέσεις",
    },
    sectionCopy: SECTION_COPY,
  },
  nl: {
    nav: { profile: "Profiel", dashboard: "Dashboard", jobs: "Banen", find: "Zoeken", accounts: "Accounts", messages: "Berichten", wallet: "Wallet" },
    shell: {
      dashboard: "Dashboard",
      language: "Taal",
      feedback: "Feedback",
      syncingData: "Synchroniseren",
      liveShellReady: "Systeem klaar",
      liveShellDescription: "Het dashboard behoudt de referentielay-out en opent daaronder banen, zoeken, berichten en wallet.",
      creator: "Maker",
    },
    home: {
      applications: "sollicitaties",
      viewApplications: "Bekijk je sollicitaties",
      jobsAvailable: "Beschikbare banen",
      findMoreOpportunities: "Vind meer kansen",
      opportunityFeedWillAppearHere: "De kansenfeed verschijnt hier",
      readyToStart: "Klaar om te beginnen?",
      browseAvailableJobsAndStartApplying: "Blader door beschikbare banen en begin met solliciteren",
      browseJobs: "Banen bekijken",
      openRoles: "Open rollen",
      unreadUpdates: "Ongelezen updates",
      pendingPayout: "Openstaande uitbetaling",
      workflowInMotion: "Workflow actief",
      workflowInMotionDescription: "Hier worden al {assignments} opdrachten en {applications} sollicitaties gevolgd.",
      applicationsInProgress: "Sollicitaties in behandeling",
      applicationsInProgressDescription: "Blijf je wachtrij volgen en ontdek meer open rollen vanuit hetzelfde dashboard.",
      openMessages: "Berichten openen",
      viewJobs: "Banen bekijken",
    },
    sectionCopy: SECTION_COPY,
  },
};


function feedbackRatingLabel(rating: number) {
  if (rating <= 1) return "Very poor";
  if (rating === 2) return "Needs work";
  if (rating === 3) return "Okay";
  if (rating === 4) return "Good";
  return "Excellent";
}

function detectDeviceClass() {
  if (typeof window === "undefined") return "desktop";
  if (window.matchMedia("(max-width: 639px)").matches) return "mobile";
  if (window.matchMedia("(max-width: 1279px)").matches) return "tablet";
  return "desktop";
}

function createFeedbackDraft(): DashboardFeedbackDraft {
  return {
    category: "ux",
    rating: 4,
    message: "",
    allowContact: true,
  };
}

function resolveLanguageCodeFromBrowser(): LanguageCode {
  if (typeof navigator === "undefined") return "en";
  const candidates = navigator.languages && navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  for (const candidate of candidates) {
    const normalized = String(candidate ?? "").trim().toLowerCase();
    const match = LANGUAGE_OPTIONS.find((option) => normalized === option.code || normalized.startsWith(`${option.code}-`));
    if (match) return match.code;
  }
  return "en";
}

function resolveInitialLanguageCode(): LanguageCode {
  if (typeof window === "undefined") return "en";
  try {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    const normalized = String(saved ?? "").trim().toLowerCase();
    const existing = LANGUAGE_OPTIONS.find((language) => language.code === normalized);
    return existing?.code ?? resolveLanguageCodeFromBrowser();
  } catch {
    return resolveLanguageCodeFromBrowser();
  }
}

function readCachedSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(AUTH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession | null;
    return parsed ?? null;
  } catch {
    return null;
  }
}

function isLocalDevHost() {
  if (process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE !== "true" || typeof window === "undefined") return false;
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function titleizeIdentity(value: string) {
  return value
    .replace(/[._-]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function identityFromWorkerCode(workerCode?: string | null) {
  const compact = String(workerCode ?? "")
    .trim()
    .replace(/^WKR[-_]?/i, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim();
  const local = compact ? compact.toLowerCase().replace(/\s+/g, ".") : "creator";
  return {
    email: `${local}@example.test`,
    name: titleizeIdentity(compact || "Creator"),
  };
}

const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeProfileEmail(value?: string | null) {
  return String(value ?? "").trim().toLowerCase();
}

function isGeneratedProfileEmail(email?: string | null, workerCode?: string | null) {
  const value = normalizeProfileEmail(email);
  if (!value || value === "no email on file") return false;
  if (value.endsWith("@example.test")) return true;
  return value === normalizeProfileEmail(identityFromWorkerCode(workerCode).email);
}

function usableContactEmail(email?: string | null, workerCode?: string | null) {
  const value = normalizeProfileEmail(email);
  if (!EMAIL_ADDRESS_PATTERN.test(value) || isGeneratedProfileEmail(value, workerCode)) return "";
  return value;
}

function mergeCachedSessionIdentity(identity: { name: string; email: string; workerId?: string | null }) {
  if (typeof window === "undefined") return;
  try {
    const current = readCachedSession() ?? {};
    const next: AuthSession = {
      ...current,
      role: current.role ?? "Worker",
      workerId: current.workerId ?? identity.workerId ?? undefined,
      name: identity.name.trim(),
      email: normalizeProfileEmail(identity.email),
      at: Date.now(),
    };
    window.localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(next));
  } catch {
    // ignore localStorage persistence failures
  }
}

function isSyntheticDevWorkerProfile(profile?: DashboardWorkerProfile | null) {
  if (!profile) return false;
  const workerId = String(profile.workerId ?? profile.id ?? "").trim().toLowerCase();
  const userId = String(profile.userId ?? "").trim().toLowerCase();
  return !!workerId && userId.startsWith("dev-");
}

function readCachedGigFeed(): Gig[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(GIGS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { items?: Gig[]; cachedAt?: number } | null;
    const cachedAt = Number(parsed?.cachedAt ?? 0);
    if (!Number.isFinite(cachedAt) || Date.now() - cachedAt > GIGS_CACHE_TTL_MS) return [];
    return Array.isArray(parsed?.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

function writeCachedGigFeed(items: Gig[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      GIGS_CACHE_KEY,
      JSON.stringify({
        items,
        cachedAt: Date.now(),
      })
    );
  } catch {
    // ignore persistence issues
  }
}

function writeCachedGigApplications(items: GigApplication[]) {
  const scope = creatorCacheIdentity();
  if (scope) patchCachedDashboard(scope, { applications: items });
}

function clearDashboardAuthState() {
  if (typeof window === "undefined") return;
  clearCreatorDeviceCache();
  try {
    window.localStorage.removeItem(AUTH_CACHE_KEY);
    window.localStorage.removeItem(GIG_APPLICATIONS_CACHE_KEY);
    window.localStorage.setItem(LOGOUT_MARKER_KEY, JSON.stringify({ at: Date.now() }));
  } catch {
    // ignore persistence issues
  }

  try {
    window.sessionStorage.clear();
  } catch {
    // ignore persistence issues
  }
}

function writeDashboardSectionToUrl(section: DashboardSection, options?: { gigId?: string | null; intent?: "details" | "apply" }, push = false) {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("section", section);
    url.searchParams.delete("view");
    url.searchParams.delete("gigId");
    url.searchParams.delete("gigid");
    url.searchParams.delete("gigType");
    url.searchParams.delete("intent");
    url.hash = "";
    if (section === "find" && options?.gigId) {
      url.searchParams.set("gigId", String(options.gigId));
      if (options.intent === "apply") url.searchParams.set("intent", "apply");
    }
    const destination = `${url.pathname}${url.search}`;
    if (destination !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      if (push) window.history.pushState(null, "", destination);
      else window.history.replaceState(null, "", destination);
    }
  } catch {
    // ignore URL sync issues
  }
}

async function fetchCollection<T>(url: string, init?: RequestInit): Promise<T[]> {
  const response = await fetch(url, { method: "GET", cache: "no-store", ...init });
  if (!response.ok) {
    throw new Error(`Failed to load ${url}`);
  }
  const payload = await response.json();
  return Array.isArray(payload) ? (payload as T[]) : [];
}

async function fetchPayload<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  if (!response.ok) {
    throw new Error(`Failed to load ${url}`);
  }
  return (await response.json()) as T;
}

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function dashboardDelayStyle(delay = 0): CSSProperties {
  return { ["--dashboard-delay" as string]: `${delay}ms` };
}

function DashboardReveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <div className={cx("dashboard-reveal", className)} style={dashboardDelayStyle(delay)}>
      {children}
    </div>
  );
}


function getDisplayName(user?: {
  email?: string | null;
  user_metadata?: { name?: string | null; full_name?: string | null };
} | null) {
  const explicit = String(user?.user_metadata?.name ?? user?.user_metadata?.full_name ?? "").trim();
  if (explicit) return explicit;

  const email = String(user?.email ?? "").trim();
  if (!email) return "Creator";

  const local = email.split("@")[0]?.replace(/[._-]+/g, " ").trim();
  if (!local) return "Creator";

  const normalized = titleizeIdentity(local);
  return normalized || "Creator";
}

function userMetadataString(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object") return "";
  return String((metadata as Record<string, unknown>)[key] ?? "").trim();
}

function userMetadataContactEmail(user?: { user_metadata?: unknown } | null, workerCode?: string | null) {
  return (
    usableContactEmail(userMetadataString(user?.user_metadata, "dashboard_email"), workerCode) ||
    usableContactEmail(userMetadataString(user?.user_metadata, "contact_email"), workerCode)
  );
}

function findMatchingWorkerProfile(
  workers: DashboardWorkerProfile[],
  options: { workerId?: string | null; userId?: string | null; email?: string | null }
) {
  const workerId = String(options.workerId ?? "").trim().toLowerCase();
  const userId = String(options.userId ?? "").trim().toLowerCase();
  const email = String(options.email ?? "").trim().toLowerCase();

  return (
    workers.find((worker) => String(worker.workerId ?? worker.id).trim().toLowerCase() === workerId) ??
    workers.find((worker) => String(worker.userId ?? "").trim().toLowerCase() === userId) ??
    workers.find((worker) => String(worker.email ?? "").trim().toLowerCase() === email) ??
    null
  );
}

function getInitials(name: string, limit = 2) {
  const compact = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (compact.length === 0) return "S";
  const clampedLimit = Math.max(1, Math.min(limit, compact.length));
  if (clampedLimit === 1) return compact[0].slice(0, 1).toUpperCase();
  return compact
    .slice(0, clampedLimit)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

function safeTime(value?: string | null) {
  if (!value) return 0;
  const next = new Date(value).getTime();
  return Number.isFinite(next) ? next : 0;
}

function formatShortDate(value?: string | null) {
  if (!value) return "Today";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Today";
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

function formatDetailedDate(value?: string | null) {
  if (!value) return "Unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatRelative(value?: string | null) {
  const time = safeTime(value);
  if (!time) return "Just now";
  const deltaMs = Date.now() - time;
  const deltaHours = Math.max(1, Math.round(deltaMs / (1000 * 60 * 60)));
  if (deltaHours < 24) return `${deltaHours}h ago`;
  const deltaDays = Math.round(deltaHours / 24);
  if (deltaDays < 7) return `${deltaDays}d ago`;
  return formatShortDate(value);
}

function formatStatusLabel(status?: string | null) {
  const raw = String(status ?? "").trim();
  if (!raw) return "Pending";
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isWorkspaceGig(gig: Pick<Gig, "gigType" | "title">) {
  const raw = String(gig.gigType ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  if (raw === "workspace" || raw === "full-time" || raw === "fulltime") return true;
  return /\b(workspace|full[\s-]?time)\b/i.test(gig.title || "");
}

function isEmailCreatorGig(gig: Pick<Gig, "gigType">) {
  const raw = String(gig.gigType ?? "")
    .trim()
    .toLowerCase();
  return raw === "" || raw === "email creator" || raw === "part-time" || raw === "part time";
}

function isProjectGig(gig: Pick<Gig, "gigType">) {
  return String(gig.gigType ?? "")
    .trim()
    .toLowerCase() === "project";
}

/** Scrolls to the gig page's account setup once it has rendered, and flashes it so the eye lands there. */
function revealAccountSetup(attempt = 0) {
  if (typeof window === "undefined") return;
  const target = document.getElementById(ACCOUNT_SETUP_ANCHOR);
  if (!target) {
    if (attempt < 90) window.requestAnimationFrame(() => revealAccountSetup(attempt + 1));
    return;
  }
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  target.focus({ preventScroll: true });
  if (!reduceMotion) {
    target.animate(
      [{ boxShadow: "0 0 0 0 rgba(46,125,79,0)" }, { boxShadow: "0 0 0 4px rgba(46,125,79,0.35)", offset: 0.25 }, { boxShadow: "0 0 0 0 rgba(46,125,79,0)" }],
      { duration: 1800, delay: 350, easing: "ease-out" }
    );
  }
}

function isContentPostingGig(gig: Pick<Gig, "gigType">) {
  return String(gig.gigType ?? "")
    .trim()
    .toLowerCase() === "content posting";
}

function isCustomGig(gig: Pick<Gig, "gigType" | "title">) {
  const raw = String(gig.gigType ?? "").trim().toLowerCase();
  if (!raw) return false;
  if (raw === "project" || raw === "content posting") return false;
  if (raw === "email creator" || raw === "part-time" || raw === "part time") return false;
  if (raw === "workspace" || raw === "full-time" || raw === "full time" || raw === "fulltime") return false;
  return !isWorkspaceGig(gig);
}

function requirementTags(gig: Pick<Gig, "requirements">) {
  return (gig.requirements ?? [])
    .filter((item) => {
      const lower = String(item).toLowerCase();
      return !lower.startsWith("brief::") && !lower.startsWith("meta::") && !lower.startsWith("media::") && !lower.startsWith("sample::");
    })
    .slice(0, 3);
}

function formatGigTypeLabel(raw?: string | null) {
  const value = String(raw ?? "").trim();
  if (!value) return "Open level";
  if (/^custom:\s*/i.test(value)) return value.replace(/^custom:\s*/i, "").trim() || "Freelance";
  if (/^category:\s*/i.test(value)) return value.replace(/^category:\s*/i, "").trim() || "Freelance";
  return value;
}

function getGigBrief(gig: Pick<Gig, "requirements">) {
  const line = (gig.requirements ?? []).find((item) => String(item).toLowerCase().startsWith("brief::"));
  return line ? String(line).replace(/^brief::/i, "").trim() : "";
}

function getGigRequirementItems(gig: Pick<Gig, "requirements">) {
  return (gig.requirements ?? []).filter((item) => {
    const lower = String(item).toLowerCase();
    return !lower.startsWith("brief::") && !lower.startsWith("meta::") && !lower.startsWith("media::") && !lower.startsWith("sample::");
  });
}

function getGigMeta(gig: Pick<Gig, "requirements">) {
  return (gig.requirements ?? []).reduce<Record<string, string>>((acc, item) => {
    const raw = String(item);
    if (!raw.toLowerCase().startsWith("meta::")) return acc;
    const clean = raw.replace(/^meta::/i, "");
    const split = clean.indexOf("=");
    if (split <= 0) return acc;
    const key = clean.slice(0, split).trim().toLowerCase();
    const value = clean.slice(split + 1).trim();
    if (key && value) acc[key] = value;
    return acc;
  }, {});
}

function getDashboardApplicationMode(gig: Pick<Gig, "requirements" | "applicationMode">): GigApplicationMode {
  return resolveGigApplicationMode(gig, "apply");
}

function compactLocationLabel(value?: string | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return "Remote";
  const parts = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length === 0) return "Remote";
  return parts.length > 1 ? parts[parts.length - 1] : parts[0];
}

function getProposalReviewStatus(application?: GigApplication | null): ProposalPayload["reviewStatus"] | null {
  const explicit = application?.proposal?.reviewStatus;
  if (explicit === "Accepted" || explicit === "Rejected" || explicit === "Pending") return explicit;
  const rawStatus = String(application?.status ?? "").trim().toLowerCase();
  if (!rawStatus) return null;
  if (rawStatus === "accepted" || rawStatus === "assigned") return "Accepted";
  if (rawStatus === "rejected") return "Rejected";
  return "Pending";
}

function gigCardSummary(gig: Gig) {
  const tags = requirementTags(gig);
  const location = compactLocationLabel(gig.location);
  const base = `${gig.company} is looking for ${gig.platform} creators${location !== "Remote" ? ` in ${location}` : ""}.`;
  if (tags.length > 0) {
    return `${base} Focus areas: ${tags.join(", ")}.`;
  }
  if (gig.workload) {
    return `${base} Best fit for ${gig.workload.toLowerCase()} delivery.`;
  }
  return base;
}

function badgeToneClasses(tone: DashboardMessage["tone"]) {
  if (tone === "amber") return "bg-[#eef4d1] text-[#4a6658]";
  if (tone === "green") return "bg-[#e9f3e5] text-[#40695b]";
  if (tone === "blue") return "bg-[#eef3ea] text-[#557267]";
  return "bg-[#f0f3ee] text-[#788479]";
}

function batchTotal(batch: PayoutBatch) {
  return (batch.items ?? []).reduce((sum, item) => sum + Number(item.amountINR ?? 0), 0);
}

function countUnreadThreads(items: DashboardMessage[]) {
  return items.reduce((sum, item) => sum + (item.unread ? 1 : 0), 0);
}

function inboxThreadKey(thread: Pick<DashboardMessage, "id" | "timestamp">) {
  return `${thread.id}@${thread.timestamp ?? ""}`;
}

function inboxThreadCategory(thread: Pick<DashboardMessage, "id">): InboxFilter {
  if (thread.id.startsWith("application-")) return "applications";
  if (thread.id.startsWith("assignment-")) return "assignments";
  if (thread.id.startsWith("payout-")) return "payouts";
  return "all";
}

function inboxCategoryLabel(thread: Pick<DashboardMessage, "id">) {
  const category = inboxThreadCategory(thread);
  if (category === "applications") return "Application";
  if (category === "assignments") return "Assignment";
  if (category === "payouts") return "Payout";
  return thread.id === "starter-thread" ? "Getting started" : "Reelencer";
}

function inboxSenderInitials(name: string) {
  const words = name.trim().split(/[\s_-]+/).filter(Boolean);
  if (!words.length) return "R";
  const parts = words.length > 1 ? words : words[0].match(/[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])/g) ?? words;
  const [first = "", second = ""] = parts;
  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase() || "R";
}

function inboxAvatarClasses(tone: DashboardMessage["tone"]) {
  if (tone === "amber") return "bg-[#f3ecc8] text-[#6b5a1e]";
  if (tone === "green") return "bg-[#dcefd8] text-[#2f5e4c]";
  if (tone === "blue") return "bg-[#dde9f3] text-[#33566f]";
  return "bg-[#e7ebe5] text-[#5d6a62]";
}

function inboxDateGroup(thread: Pick<DashboardMessage, "id" | "timestamp">) {
  const time = safeTime(thread.timestamp);
  if (!time) return thread.id === "starter-thread" ? "Getting started" : "Updates";
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const dayMs = 24 * 60 * 60 * 1000;
  if (time >= startOfToday.getTime()) return "Today";
  if (time >= startOfToday.getTime() - dayMs) return "Yesterday";
  if (time >= startOfToday.getTime() - 6 * dayMs) return "This week";
  return "Earlier";
}

function inboxListTime(value?: string | null) {
  const time = safeTime(value);
  if (!time) return "";
  const date = new Date(time);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  if (time >= startOfToday.getTime()) return date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function inboxThreadStatus(thread: Pick<DashboardMessage, "status">) {
  return thread.status?.trim() || "Update";
}

function inboxStatusPillClasses(status: string) {
  const lower = status.toLowerCase();
  if (["accepted", "paid", "approved", "completed"].includes(lower)) return "bg-[#e3f2df] text-[#2f6a4d]";
  if (["rejected", "failed", "closed", "cancelled"].includes(lower)) return "bg-[#fbe9e7] text-[#b42318]";
  if (["submitted", "processing"].includes(lower)) return "bg-[#e3edf6] text-[#33566f]";
  return "bg-[#f6efd6] text-[#7a5b12]";
}

function inboxProgressSteps(thread: Pick<DashboardMessage, "id" | "status" | "preview">): Array<{ label: string; state: InboxStepState }> {
  const category = inboxThreadCategory(thread);
  const status = inboxThreadStatus(thread).toLowerCase();
  const failed = ["rejected", "failed", "cancelled"].includes(status);
  const build = (labels: string[], reached: number) =>
    labels.map((label, idx) => ({
      label,
      state: (idx < reached ? "done" : idx === reached ? (failed ? "failed" : "current") : "todo") as InboxStepState,
    }));

  if (category === "applications") {
    const reached = status === "accepted" ? 3 : failed ? 2 : 1;
    return build(["Applied", status === "pending" ? "Awaiting review" : "In review", failed ? "Not selected" : "Decision"], reached);
  }
  if (category === "assignments") {
    const reached = status === "accepted" || status === "completed" ? 3 : failed ? 2 : status === "submitted" ? 2 : 1;
    return build(["Assigned", "In progress", failed ? "Not approved" : status === "submitted" ? "Awaiting approval" : "Approved"], reached);
  }
  if (category === "payouts") {
    const reached = status === "paid" ? 3 : ["processing", "approved"].includes(status) ? 2 : failed ? 2 : 1;
    return build(["Created", "Processing", failed ? "Rejected" : ["processing", "approved"].includes(status) ? "Awaiting payment" : "Paid"], reached);
  }
  return [];
}

function inboxReference(thread: Pick<DashboardMessage, "id">) {
  const raw = thread.id.includes("-") ? thread.id.slice(thread.id.indexOf("-") + 1) : thread.id;
  return raw.toUpperCase();
}

function inboxReaderTime(value?: string | null) {
  const time = safeTime(value);
  if (!time) return "";
  const date = new Date(time);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const label = date.toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
  const withinWeek = Date.now() - time < 7 * 24 * 60 * 60 * 1000;
  return withinWeek ? `${label} (${formatRelative(value)})` : label;
}

function inboxFullTimestamp(value?: string | null) {
  const time = safeTime(value);
  if (!time) return "No date";
  return new Date(time).toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}



// Overview = a widget grid (mixed-height tiles), not a house: Jobs is the landing page now.
function DashboardIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" {...props}>
      <rect x="4.5" y="4.5" width="6.25" height="8.5" rx="1.75" />
      <rect x="4.5" y="15.5" width="6.25" height="4" rx="1.5" />
      <rect x="13.25" y="4.5" width="6.25" height="4" rx="1.5" />
      <rect x="13.25" y="11" width="6.25" height="8.5" rx="1.75" />
    </svg>
  );
}

function ProfileIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="8.75" r="3.75" />
      <path d="M5 19.5c1.1-3.2 3.8-5 7-5s5.9 1.8 7 5" />
    </svg>
  );
}

function JobsIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <rect x="5" y="4.5" width="14" height="16" rx="2.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 4.5h6v3H9z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.5 10h7M8.5 14h7" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" strokeLinecap="round" />
    </svg>
  );
}

function LocationPinIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M12 20c3.5-4 5.5-7 5.5-10.1A5.5 5.5 0 0 0 6.5 9.9C6.5 13 8.5 16 12 20Z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="9.5" r="1.9" />
    </svg>
  );
}

function MessagesIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path
        d="M5.5 6.5h13A1.5 1.5 0 0 1 20 8v7a1.5 1.5 0 0 1-1.5 1.5H9l-4 3v-3H5.5A1.5 1.5 0 0 1 4 15V8a1.5 1.5 0 0 1 1.5-1.5Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AccountsIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3.5" y="3.5" width="11" height="11" rx="3.2" />
      <circle cx="9" cy="9" r="2.4" />
      <path d="M17.5 9.5h.5a2.5 2.5 0 0 1 2.5 2.5v6a2.5 2.5 0 0 1-2.5 2.5h-6A2.5 2.5 0 0 1 9.5 18v-.5" />
      <path d="m13.5 17.5 1.8-1.8 1.6 1.4 2.1-2.6" />
    </svg>
  );
}

function WalletIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M4.5 8.5A2.5 2.5 0 0 1 7 6h10a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 17 18H7a2.5 2.5 0 0 1-2.5-2.5z" />
      <path d="M16 12h3.5" strokeLinecap="round" />
      <circle cx="15.25" cy="12" r="1" fill="currentColor" stroke="none" />
      <path d="M7 6V5.5A1.5 1.5 0 0 1 8.5 4h8" strokeLinecap="round" />
    </svg>
  );
}

function GearIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path
        d="M12 8.25a3.75 3.75 0 1 0 0 7.5a3.75 3.75 0 0 0 0-7.5Zm8 3.75-.92-.53a7.88 7.88 0 0 0-.44-1.06l.35-.99a1 1 0 0 0-.24-1.05l-1.45-1.45a1 1 0 0 0-1.05-.24l-.99.35c-.34-.17-.69-.32-1.06-.44L14 4a1 1 0 0 0-.98-.75h-2.04A1 1 0 0 0 10 4l-.24 1.02c-.37.12-.72.27-1.06.44l-.99-.35a1 1 0 0 0-1.05.24L5.21 6.8a1 1 0 0 0-.24 1.05l.35.99c-.17.34-.32.69-.44 1.06L4 10a1 1 0 0 0-.75.98v2.04A1 1 0 0 0 4 14l1.02.24c.12.37.27.72.44 1.06l-.35.99a1 1 0 0 0 .24 1.05l1.45 1.45a1 1 0 0 0 1.05.24l.99-.35c.34.17.69.32 1.06.44L10 20a1 1 0 0 0 .98.75h2.04A1 1 0 0 0 14 20l.24-1.02c.37-.12.72-.27 1.06-.44l.99.35a1 1 0 0 0 1.05-.24l1.45-1.45a1 1 0 0 0 .24-1.05l-.35-.99c.17-.34.32-.69.44-1.06L20 14a1 1 0 0 0 .75-.98v-2.04A1 1 0 0 0 20 12Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MobileMenuToggleButton({
  open,
  label,
  onClick,
  buttonRef,
}: {
  open: boolean;
  label: string;
  onClick: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const bar = "absolute left-0 h-[1.75px] w-full rounded-full bg-current transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none";
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-controls="dashboard-mobile-menu"
      aria-label={label}
      className="flex h-10 w-10 touch-manipulation items-center justify-center rounded-lg text-[#1a201c] transition hover:bg-[#eceeea] active:bg-[#e3e5e1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40"
    >
      <span aria-hidden="true" className="relative block h-3.5 w-[18px]">
        <span className={cx(bar, "top-0", open && "translate-y-[6.1px] rotate-45")} />
        <span className={cx(bar, "top-1/2 -translate-y-1/2 transition-opacity", open && "opacity-0")} />
        <span className={cx(bar, "bottom-0", open && "-translate-y-[6.1px] -rotate-45")} />
      </span>
    </button>
  );
}

function CloseIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" {...props}>
      <path d="M7 7l10 10M17 7 7 17" strokeLinecap="round" />
    </svg>
  );
}

function LogoutIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M10 7.25H7.75A2.75 2.75 0 0 0 5 10v6.25A2.75 2.75 0 0 0 7.75 19H10" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 8.5 17.5 12 13 15.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 12H9.5" strokeLinecap="round" />
    </svg>
  );
}

function ArrowRightIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M5.5 12h13" strokeLinecap="round" />
      <path d="m13.5 7 5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronDownIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="m7 10 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="m5.5 12.5 4.2 4.2L18.5 8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const PLATFORM_DOT_COLORS: Record<string, string> = {
  instagram: "bg-[radial-gradient(circle_at_30%_110%,#fdf497_0%,#fd5949_45%,#d6249f_60%,#285aeb_90%)]",
  youtube: "bg-[#ff0033]",
  tiktok: "bg-[#111111]",
  x: "bg-[#111111]",
  twitter: "bg-[#111111]",
  facebook: "bg-[#1877f2]",
  linkedin: "bg-[#0a66c2]",
  snapchat: "bg-[#fffc00] ring-1 ring-black/10",
  threads: "bg-[#111111]",
  email: "bg-[#41695b]",
};

function platformDotClass(platform: string) {
  return PLATFORM_DOT_COLORS[platform.trim().toLowerCase()] ?? "bg-[#9aa59e]";
}

function DashboardChipScroller({
  children,
  className,
  activeKey,
  itemCount,
  label,
  onKeyDown,
}: {
  children: ReactNode;
  className?: string;
  activeKey: string;
  itemCount: number;
  label: string;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const hasMountedRef = useRef(false);
  const [fade, setFade] = useState<"none" | "left" | "right" | "both">("none");

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 4;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
      setFade(left && right ? "both" : left ? "left" : right ? "right" : "none");
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [itemCount]);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    const el = scrollerRef.current;
    const active = el?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (!el || !active) return;
    const target = active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2;
    el.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  }, [activeKey]);

  return (
    <div ref={scrollerRef} role="radiogroup" aria-label={label} data-fade={fade} onKeyDown={onKeyDown} className={cx("dashboard-chip-scroller", className)}>
      {children}
    </div>
  );
}

function StarIcon({ filled = false, ...props }: IconProps & { filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" {...props}>
      <path
        d="m12 3.8 2.47 5.01 5.53.8-4 3.9.94 5.5L12 16.42 7.06 19.01 8 13.51l-4-3.9 5.53-.8L12 3.8Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}



function SparkIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="m12 4 1.9 4.6L18.5 10l-4.6 1.4L12 16l-1.9-4.6L5.5 10l4.6-1.4L12 4Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}


function PlayIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M8.5 6.8a1 1 0 0 1 1.5-.86l8.2 5.2a1 1 0 0 1 0 1.7l-8.2 5.2a1 1 0 0 1-1.5-.85V6.8Z" />
    </svg>
  );
}


const SIDEBAR_COLLAPSED_KEY = "reelencer-sidebar-collapsed";
const sidebarCollapsedListeners = new Set<() => void>();

function subscribeSidebarCollapsed(listener: () => void) {
  sidebarCollapsedListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === SIDEBAR_COLLAPSED_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    sidebarCollapsedListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function readSidebarCollapsed() {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSidebarCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // storage unavailable; the toggle still applies for this visit via listeners below
  }
  sidebarCollapsedListeners.forEach((listener) => listener());
}

function SidebarAccountMenu({
  variant,
  initials,
  name,
  meta,
  role,
  active,
  languageLabel,
  languageFlag,
  feedbackLabel,
  logoutPending,
  onProfile,
  onLanguage,
  onFeedback,
  onLogout,
}: {
  variant: "full" | "rail";
  initials: string;
  name: string;
  meta: string;
  role: string;
  active: boolean;
  languageLabel: string;
  languageFlag: string;
  feedbackLabel: string;
  logoutPending: boolean;
  onProfile: () => void;
  onLanguage: () => void;
  onFeedback: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = event.key === "ArrowDown" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
      items[next]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  const item =
    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] font-medium text-[#1a201c] outline-none transition hover:bg-[#f3f4f1] focus-visible:bg-[#eceeea]";

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={variant === "rail" ? `Account: ${name}` : undefined}
        title={variant === "rail" ? name : undefined}
        className={cx(
          "group flex items-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40",
          variant === "full"
            ? cx("w-full gap-2.5 rounded-lg p-2 text-left hover:bg-[#f3f4f1]", (open || active) && "bg-[#f3f4f1]")
            : "h-11 w-11 justify-center rounded-lg hover:bg-[#f3f4f1]"
        )}
      >
        <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1f2b24] text-[13px] font-semibold text-white" aria-hidden="true">
          {initials}
          <span className="absolute -bottom-px -right-px h-2.5 w-2.5 rounded-full border-2 border-white bg-[#2e7d4f]" />
        </span>
        {variant === "full" ? (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-[#1a201c]">{name}</span>
              <span className="block truncate text-[11.5px] text-[#7a827c]">{role}</span>
            </span>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4 shrink-0 text-[#8a928c]" aria-hidden="true">
              <path d="m6.5 8 3.5-3.5L13.5 8M6.5 12l3.5 3.5 3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </>
        ) : null}
      </button>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKeyDown}
          className={cx(
            "absolute z-50 w-[248px] rounded-xl border border-[#e3e5e1] bg-white p-1.5 shadow-[0_16px_40px_-12px_rgba(15,20,17,0.28)] dashboard-menu-pop",
            variant === "full" ? "bottom-full left-0 mb-2" : "bottom-0 left-full ml-2"
          )}
        >
          <div className="border-b border-[#ebedea] px-2.5 pb-2 pt-1.5">
            <div className="truncate text-[13px] font-semibold text-[#1a201c]">{name}</div>
            <div className="truncate text-[12px] text-[#7a827c]">{meta}</div>
          </div>
          <div className="py-1">
            <button type="button" role="menuitem" tabIndex={-1} onClick={() => run(onProfile)} className={item}>
              <GearIcon className="h-4 w-4 text-[#616a64]" />
              Profile & settings
            </button>
            <button type="button" role="menuitem" tabIndex={-1} data-language-trigger="true" onClick={() => run(onLanguage)} className={item}>
              <span className="flex h-4 w-4 items-center justify-center text-[14px] leading-none">{languageFlag}</span>
              <span className="flex-1">Language</span>
              <span className="text-[12px] text-[#7a827c]">{languageLabel}</span>
            </button>
            <button type="button" role="menuitem" tabIndex={-1} onClick={() => run(onFeedback)} className={item}>
              <MessagesIcon className="h-4 w-4 text-[#616a64]" />
              {feedbackLabel}
            </button>
          </div>
          <div className="border-t border-[#ebedea] pt-1">
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={logoutPending}
              onClick={() => run(onLogout)}
              className={cx(item, "text-[#b42318] hover:bg-[#fdf2f1] focus-visible:bg-[#fdf2f1] disabled:opacity-50")}
            >
              <LogoutIcon className="h-4 w-4" />
              {logoutPending ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BrandMark({ className }: { className?: string }) {
  return <BrandLogo className={className} sizes="32px" />;
}

// Connection state for the brand's status dot; the server assumes online so hydration stays stable.
const subscribeOnline = (listener: () => void) => {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
};
const readOnline = () => navigator.onLine;

function BrandLockup({ subtitle = "Creator workspace" }: { subtitle?: string }) {
  const online = useSyncExternalStore(subscribeOnline, readOnline, () => true);
  return (
    // The wrapper takes the free width (and is what the container query measures); the link hugs its content,
    // so its hover/press surface never stretches into a wide bar beside the header buttons.
    <div className="@container/lockup min-w-0 flex-1">
      <Link
        href="/"
        aria-label={`Reelencer home · ${subtitle}${online ? "" : " · offline"}`}
        className="group/lockup flex w-fit max-w-full items-center gap-3 rounded-xl py-1.5 pl-1.5 pr-3 transition active:scale-[0.98] active:bg-[#eef0ec] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40 motion-reduce:active:scale-100 [@media(hover:hover)]:hover:bg-[#f5f6f3]"
      >
        {/* Mark: soft tile with an inner highlight; lifts slightly on hover (pointer devices only). */}
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(145deg,#ffffff,#eef3ec)] shadow-[0_1px_2px_rgba(26,32,28,0.08),inset_0_0_0_1px_rgba(26,32,28,0.07),inset_0_1px_0_rgba(255,255,255,0.9)] transition duration-200 motion-reduce:transition-none [@media(hover:hover)]:group-hover/lockup:-translate-y-px [@media(hover:hover)]:group-hover/lockup:shadow-[0_4px_10px_-4px_rgba(26,32,28,0.22),inset_0_0_0_1px_rgba(26,32,28,0.08)]">
          <BrandMark className="h-[30px] w-[30px]" />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-[Georgia,Times_New_Roman,serif] text-[18px] font-bold leading-[1.1] tracking-[-0.015em] text-[#1a201c]">Reelencer</span>
          {/* Hidden when the header is squeezed so the wordmark never truncates. */}
          <span className="mt-1 hidden min-w-0 items-center gap-1.5 @[170px]/lockup:flex">
            <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
              {online ? <span className="absolute inline-flex h-full w-full rounded-full bg-[#4caf6e] opacity-50 motion-safe:animate-ping [animation-duration:2.4s]" /> : null}
              <span className={cx("relative inline-flex h-2 w-2 rounded-full", online ? "bg-[#2e7d4f]" : "bg-[#b9c0ba]")} />
            </span>
            <span className="truncate text-[11.5px] font-medium leading-none text-[#6b736d]">{online ? subtitle : "Offline · reconnecting"}</span>
          </span>
        </span>
      </Link>
    </div>
  );
}

const subscribeNoop = () => () => {};
// Time-of-day greeting for the header; the server renders "Welcome back" so hydration stays stable.
const readGreeting = () => {
  const hour = new Date().getHours();
  return hour < 5 ? "Working late" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
};
const readShortcutLabel = () => (/mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent) ? "⌘K" : "Ctrl K");

function SidebarToggleIcon({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M9.5 4.5v15" />
      <path strokeLinecap="round" strokeLinejoin="round" d={collapsed ? "m13.5 10 2 2-2 2" : "m15.5 10-2 2 2 2"} />
    </svg>
  );
}

function LiveSyncPill({
  loading,
  syncing,
  lastSyncedAt,
  onSync,
  loadingLabel,
  saved = false,
}: {
  loading: boolean;
  syncing: boolean;
  lastSyncedAt: number | null;
  onSync?: () => void;
  loadingLabel: string;
  saved?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);

  const seconds = lastSyncedAt ? Math.max(0, Math.round((now - lastSyncedAt) / 1000)) : null;
  const ago = seconds === null ? "" : seconds < 10 ? "just now" : seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`;
  const busy = loading || syncing;
  const stale = !busy && seconds !== null && seconds > 120;
  const label = loading ? loadingLabel : saved ? syncing ? "Saved data · updating…" : ago ? `Saved ${ago}` : "Saved data" : syncing ? "Refreshing…" : ago ? `Updated ${ago}` : "Refresh updates";
  const ariaLabel = `${label}${busy ? "" : ". Refresh updates"}`;

  return (
    <button
      type="button"
      onClick={onSync}
      disabled={busy || !onSync}
      title={busy ? label : `${label} · tap to refresh`}
      aria-label={ariaLabel}
      aria-busy={busy}
      className={cx(
        "group relative inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full border border-[#e3e5e1] bg-white text-[12px] font-semibold text-[#4b544e] transition",
        "w-10 sm:w-auto sm:px-3",
        "hover:bg-[#f3f4f1] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40 disabled:cursor-default disabled:active:scale-100"
      )}
    >
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cx("h-[18px] w-[18px] shrink-0 sm:h-4 sm:w-4", busy && "animate-spin motion-reduce:animate-none")}
        aria-hidden="true"
      >
        <path d="M16 10a6 6 0 0 1-10.4 4.1M4 10a6 6 0 0 1 10.4-4.1" />
        <path d="M14.6 3.2v2.9h-2.9M5.4 16.8v-2.9h2.9" />
      </svg>
      <span className="hidden whitespace-nowrap sm:inline">{label}</span>
      <span
        className={cx(
          "absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-white sm:static sm:h-2 sm:w-2 sm:border-0",
          busy ? "animate-pulse bg-[#d99a06]" : stale || saved ? "bg-[#d99a06]" : "dashboard-live-dot bg-[#2e7d4f]"
        )}
        aria-hidden="true"
      />
    </button>
  );
}

/** Splits "INR 4,500 per campaign" into a bold amount and a smaller unit. */
function splitPayout(raw: string) {
  const text = String(raw ?? "").trim();
  const match = text.match(/^(.*?\d[\d,.]*\s*(?:k|K|L|lakh)?)\s*(.*)$/);
  if (!match) return { amount: text, unit: "" };
  return { amount: match[1].trim(), unit: match[2].trim() };
}

function SidebarNavItem({
  icon: Icon,
  label,
  active,
  badge = 0,
  onClick,
}: {
  icon: ComponentType<IconProps>;
  label: string;
  active: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cx(
        "group relative flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13.5px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40",
        active ? "bg-[#eceeea] text-[#1a201c]" : "text-[#4b544e] hover:bg-[#f3f4f1] hover:text-[#1a201c]"
      )}
    >
      <span className={cx("flex h-5 w-5 shrink-0 items-center justify-center transition", active ? "text-[#1a201c]" : "text-[#7a827c] group-hover:text-[#1a201c]")}>
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge > 0 ? (
        <span className="rounded-full bg-[#1f2b24] px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white tabular-nums">{badge > 99 ? "99+" : badge}</span>
      ) : null}
    </button>
  );
}

function RailNavItem({
  icon: Icon,
  label,
  active,
  badge = 0,
  onClick,
}: {
  icon: ComponentType<IconProps>;
  label: string;
  active: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      aria-label={badge > 0 ? `${label}, ${badge} unread` : label}
      title={label}
      className="group flex w-[64px] flex-col items-center gap-1 rounded-[14px] py-1.5 text-[10px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8db35a]"
    >
      <span
        className={cx(
          "relative flex h-9 w-11 items-center justify-center rounded-[12px] transition",
          active ? "bg-[#eceeea] text-[#1a201c]" : "text-[#616a64] group-hover:bg-[#f3f4f1] group-hover:text-[#1a201c]"
        )}
      >
        <Icon className="h-[19px] w-[19px]" />
        {badge > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full border-2 border-[#fbfcf8] bg-[#c2410c] px-1 text-[9px] font-bold text-white">
            {badge > 9 ? "9+" : badge}
          </span>
        ) : null}
      </span>
      <span className={cx("max-w-full truncate", active ? "text-[#20352c]" : "text-[#6f7d74]")}>{label}</span>
    </button>
  );
}










function GigBoardSkeletonCard() {
  return (
    <article className="flex h-full animate-pulse flex-col rounded-xl border border-[#e3e5e1] bg-white p-5 shadow-[0_1px_2px_rgba(26,32,28,0.06)]">
      <div className="flex flex-wrap items-center gap-2">
        <div className="h-6 w-20 rounded-full bg-[#eceeea]" />
        <div className="h-6 w-16 rounded-full bg-[#eceeea]" />
      </div>

      <div className="mt-5 h-7 w-[82%] rounded-[10px] bg-[#eceeea]" />
      <div className="mt-4 h-4 w-full rounded-full bg-[#f1f3f0]" />
      <div className="mt-3 h-4 w-[88%] rounded-full bg-[#f1f3f0]" />
      <div className="mt-3 h-4 w-[72%] rounded-full bg-[#f1f3f0]" />

      <div className="mt-6 flex items-end gap-2">
        <div className="h-6 w-24 rounded-[10px] bg-[#eceeea]" />
        <div className="h-4 w-20 rounded-full bg-[#eceeea]" />
      </div>

      <div className="mt-6">
        <div className="h-4 w-16 rounded-full bg-[#eceeea]" />
        <div className="mt-3 flex flex-wrap gap-2">
          <div className="h-8 w-24 rounded-full bg-[#f1f3f0]" />
          <div className="h-8 w-28 rounded-full bg-[#f1f3f0]" />
        </div>
      </div>

      <div className="mt-auto flex gap-3 pt-6">
        <div className="h-12 flex-1 rounded-[14px] bg-[#f1f3f0]" />
        <div className="h-12 flex-1 rounded-[14px] bg-[#eceeea]" />
      </div>
    </article>
  );
}


function FeedbackComposer({
  onClose,
  profileName,
  profileRole,
  sectionLabel,
  language,
  workerId,
}: {
  onClose: () => void;
  profileName: string;
  profileRole: string;
  sectionLabel: string;
  language: LanguageOption;
  workerId: string | null;
}) {
  const [draft, setDraft] = useState<DashboardFeedbackDraft>(() => createFeedbackDraft());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<{ id: string; status: DashboardFeedbackStatus; createdAt?: string | null } | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const messageCount = draft.message.length;
  const meaningfulMessageCount = draft.message.trim().length;
  const charactersNeeded = Math.max(FEEDBACK_MIN_MESSAGE_LENGTH - meaningfulMessageCount, 0);
  const canSubmit = charactersNeeded === 0 && !submitting;
  const selectedRatingLabel = draft.rating ? feedbackRatingLabel(draft.rating) : null;
  const footerHint = submitting
    ? "Sending feedback..."
    : charactersNeeded === 0
      ? "Ready to send."
      : `Add ${charactersNeeded} more meaningful ${charactersNeeded === 1 ? "character" : "characters"}.`;
  const submittedMeta = submitted
    ? [
        { label: "Ref", value: submitted.id.slice(0, 8).toUpperCase() },
        { label: "Status", value: submitted.status.charAt(0).toUpperCase() + submitted.status.slice(1) },
        { label: "Area", value: sectionLabel },
      ]
    : [];

  const updateDraft = <Key extends keyof DashboardFeedbackDraft>(key: Key, value: DashboardFeedbackDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    if (submitError) setSubmitError(null);
  };

  const resetComposer = () => {
    setDraft(createFeedbackDraft());
    setSubmitError(null);
    setSubmitted(null);
  };

  const submitFeedback = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!canSubmit || typeof window === "undefined") return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const session = await supabase.auth.getSession().catch(() => null);
      const token = session?.data.session?.access_token;
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          section: sectionLabel,
          profileName,
          profileRole,
          languageCode: language.code,
          languageName: language.nativeName,
          workerId,
          category: draft.category,
          rating: draft.rating,
          message: draft.message,
          allowContact: draft.allowContact,
          source: "dashboard",
          pageUrl: window.location.href,
          meta: {
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            deviceClass: detectDeviceClass(),
            path: window.location.pathname,
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
          },
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        missingSchema?: boolean;
        feedback?: { id?: string; status?: DashboardFeedbackStatus; created_at?: string | null };
      };

      if (!response.ok || !payload.ok || !payload.feedback?.id) {
        setSubmitError(payload.error || "Unable to submit feedback right now.");
        setSubmitting(false);
        return;
      }

      setSubmitted({
        id: payload.feedback.id,
        status: payload.feedback.status ?? "new",
        createdAt: payload.feedback.created_at ?? null,
      });
      setSubmitting(false);
    } catch {
      setSubmitError("Unable to submit feedback right now.");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-5 lg:p-6">
      <button
        type="button"
        aria-label="Close feedback form"
        className="absolute inset-0 bg-[#1f1a14]/38 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dashboard-feedback-title"
        className="relative z-10 flex h-[100svh] w-full max-w-[980px] flex-col overflow-hidden rounded-t-[30px] border border-[#e8e1d4] bg-[#fcfaf4] shadow-[0_40px_90px_-44px_rgba(27,40,31,0.28)] sm:h-auto sm:max-h-[92svh] sm:rounded-[24px]"
      >
        <div className="pointer-events-none flex justify-center py-3 sm:hidden">
          <div className="h-1.5 w-12 rounded-full bg-[#ddd3c2]" />
        </div>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={submitFeedback} aria-busy={submitting}>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="border-b border-[#efe8dc] px-5 py-4 sm:px-7 sm:py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="inline-flex items-center gap-2 rounded-full bg-[#edf5c7] px-3 py-1.5 text-[12px] font-semibold text-[#41695b]">
                    <MessagesIcon className="h-4 w-4" />
                    Feedback
                  </div>
                  <h2 id="dashboard-feedback-title" className="mt-4 text-[24px] font-semibold tracking-[-0.05em] text-[#1c1814] sm:text-[29px]">
                    Share feedback
                  </h2>
                  <p className="mt-2 max-w-[560px] text-[14px] leading-6 text-[#756e63]">
                    Report an issue or suggest an improvement. A clean summary is added automatically for review.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#e6decd] bg-white text-[#61584c] transition hover:bg-[#f8f4ea]"
                  aria-label="Close feedback form"
                >
                  <CloseIcon className="h-[18px] w-[18px]" />
                </button>
              </div>
            </div>

            {submitted ? (
              <div className="px-5 py-6 sm:px-7 sm:py-7">
                <div className="rounded-[22px] border border-[#efe3bc] bg-[#fffaf0] p-5 sm:p-6">
                  <div className="flex flex-col gap-5 sm:gap-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex items-start gap-4">
                        <div className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] bg-[#fff1be] text-[#7a5f1c]">
                          <SparkIcon className="h-7 w-7" />
                        </div>
                        <div className="min-w-0">
                          <div className="inline-flex items-center rounded-full bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#90703c]">
                            Saved
                          </div>
                          <h3 className="mt-3 text-[22px] font-semibold tracking-[-0.04em] text-[#1c1814] sm:text-[24px]">Feedback sent</h3>
                          <p className="mt-2 max-w-[460px] text-[14px] leading-6 text-[#5f6f65] sm:text-[15px]">
                            Thanks. Your note has been saved for review.
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 sm:max-w-[320px] sm:justify-end">
                        {submittedMeta.map((item) => (
                          <div
                            key={item.label}
                            className="inline-flex min-w-0 items-center gap-2 rounded-full border border-[#eadfca] bg-white/88 px-3 py-2 text-[12px] text-[#5d5449]"
                          >
                            <span className="shrink-0 font-semibold uppercase tracking-[0.14em] text-[#998d7d]">{item.label}</span>
                            <span className="truncate font-semibold text-[#1e1914]">{item.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-[22px] border border-[#efe5d0] bg-white/74 px-4 py-3 text-[13px] leading-6 text-[#786f63] sm:text-[14px]">
                      You can close this panel or send another note right away.
                    </div>
                  </div>

                  <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={resetComposer}
                      className="inline-flex items-center justify-center rounded-[14px] border border-[#ddd5c8] px-5 py-3 text-[14px] font-semibold text-[#4e453b] transition hover:bg-white"
                    >
                      New feedback
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      className="inline-flex items-center justify-center justify-center rounded-[14px] bg-[#41695b] px-5 py-3 text-[14px] font-semibold text-white shadow-[0_18px_32px_-18px_rgba(54,88,75,0.5)] transition hover:bg-[#35584b]"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="px-5 py-5 sm:px-7 sm:py-6">
                  <div className="mx-auto w-full max-w-[980px] space-y-4 sm:space-y-5">
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
                      <section className="rounded-[24px] border border-[#e6ebe2] bg-white p-4 shadow-[0_24px_40px_-30px_rgba(34,45,37,0.18)] sm:rounded-[26px] sm:p-5">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#998b7c]">Category</div>
                          <div className="text-[12px] text-[#7e7469]">Choose the closest area</div>
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-2.5 min-[430px]:grid-cols-2">
                          {FEEDBACK_CATEGORY_OPTIONS.map((option) => {
                            const active = draft.category === option.value;
                            return (
                              <button
                                key={option.value}
                                type="button"
                                aria-pressed={active}
                                onClick={() => updateDraft("category", option.value)}
                                className={cx(
                                  "min-h-[112px] rounded-[18px] border px-3.5 py-3 text-left transition sm:min-h-[118px] sm:px-4 sm:py-3.5",
                                  active
                                    ? "border-[#e3d37f] bg-[linear-gradient(135deg,#f8fbdc_0%,#edf5c7_100%)] text-[#5d6a30] shadow-[0_18px_30px_-24px_rgba(153,171,86,0.38)]"
                                    : "border-[#e6ebe2] bg-[#fcfaf4] text-[#2d241b] hover:bg-[#faf7f0]"
                                )}
                              >
                                <div className="text-[14px] font-semibold">{option.label}</div>
                                <div className="mt-1 text-[12px] leading-5 text-[#7f7265]">{option.description}</div>
                              </button>
                            );
                          })}
                        </div>
                      </section>

                      <section className="rounded-[24px] border border-[#e6ebe2] bg-white p-4 shadow-[0_24px_40px_-30px_rgba(34,45,37,0.18)] sm:rounded-[26px] sm:p-5">
                        <div className="flex flex-col gap-3">
                          <div>
                            <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#998b7c]">Experience</div>
                            <div className="mt-1 text-[13px] leading-5 text-[#7b7063]">Choose a score for this experience.</div>
                          </div>
                          <div className="inline-flex w-fit rounded-full bg-[#f7f2e7] px-3 py-1.5 text-[12px] font-medium text-[#6d6255]">
                            {selectedRatingLabel ?? "Select a rating"}
                          </div>
                        </div>
                        <div className="mt-4 grid grid-cols-5 gap-2 sm:gap-2.5">
                          {[1, 2, 3, 4, 5].map((rating) => {
                            const active = draft.rating === rating;
                            return (
                              <button
                                key={rating}
                                type="button"
                                aria-pressed={active}
                                onClick={() => updateDraft("rating", rating)}
                                className={cx(
                                  "flex h-14 items-center justify-center rounded-[18px] border text-center transition sm:h-16",
                                  active
                                    ? "border-[#e3d37f] bg-[linear-gradient(180deg,#fff7d7_0%,#fff1be_100%)] text-[#41695b] shadow-[0_16px_26px_-22px_rgba(141,103,32,0.42)]"
                                    : "border-[#e6ebe2] bg-[#fcfaf4] text-[#5a5046] hover:bg-[#faf7f0]"
                                )}
                                aria-label={`${rating} ${feedbackRatingLabel(rating)}`}
                              >
                                <div className="text-[20px] font-semibold leading-none sm:text-[22px]">{rating}</div>
                              </button>
                            );
                          })}
                        </div>
                        <div className="mt-4 text-[13px] leading-5 text-[#746a5d]">
                          Area and language are added automatically.
                        </div>
                      </section>
                    </div>

                    <section className="rounded-[24px] border border-[#e6ebe2] bg-white p-4 shadow-[0_24px_40px_-30px_rgba(34,45,37,0.18)] sm:rounded-[26px] sm:p-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#998b7c]">Details</div>
                          <div className="mt-1 text-[13px] leading-5 text-[#7b7063]">Describe what happened, what you expected, and where it happened.</div>
                        </div>
                        <div className={cx("rounded-full px-3 py-1.5 text-[12px] font-medium", charactersNeeded === 0 ? "bg-[#f7f2e7] text-[#7e6934]" : "bg-[#fff2ea] text-[#b0694a]")}>
                          {messageCount}/{FEEDBACK_MAX_MESSAGE_LENGTH}
                        </div>
                      </div>
                      <textarea
                        value={draft.message}
                        required
                        minLength={FEEDBACK_MIN_MESSAGE_LENGTH}
                        maxLength={FEEDBACK_MAX_MESSAGE_LENGTH}
                        onChange={(event) => updateDraft("message", event.target.value)}
                        placeholder="What happened, what did you expect, and where in the dashboard were you when it happened?"
                        className="mt-4 min-h-[170px] w-full resize-y rounded-[20px] border border-[#e6ebe2] bg-[#fcfaf4] px-4 py-4 text-[15px] leading-7 text-[#20352c] outline-none transition placeholder:text-[#ab9f91] focus:border-[#f0df99] focus:ring-2 focus:ring-[#fff3c1] sm:min-h-[210px]"
                      />
                      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
                        <div className="rounded-[18px] border border-[#e6ebe2] bg-[#fcfaf4] px-4 py-3.5 text-[13px] leading-5 text-[#746a5d]">
                          Include the steps, the expected result, and anything that would help us reproduce or improve it.
                        </div>
                        <label className="flex items-start gap-3 rounded-[18px] border border-[#e6ebe2] bg-[#fcfaf4] px-4 py-3.5">
                          <input
                            type="checkbox"
                            checked={draft.allowContact}
                            onChange={(event) => updateDraft("allowContact", event.target.checked)}
                            className="mt-1 h-4 w-4 rounded border-[#d4cbbd] accent-[#111111]"
                          />
                          <span className="min-w-0">
                            <span className="block text-[14px] font-semibold text-[#2d241b]">Allow follow-up</span>
                            <span className="mt-1 block text-[13px] leading-5 text-[#776b5f]">We may reach out if more detail is needed.</span>
                          </span>
                        </label>
                      </div>
                    </section>

                    {submitError ? (
                      <div className="rounded-[18px] border border-[#f0ddd2] bg-[#fff7f2] px-4 py-3 text-[14px] text-[#955c3f]">
                        {submitError}
                      </div>
                    ) : (
                      <div className="text-[13px] leading-5 text-[#72675b]">Only sent after you submit.</div>
                    )}
                  </div>
                </div>

                <div className="shrink-0 border-t border-[#efe8dc] bg-[#fcfaf4] px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:px-7 sm:py-5 sm:pb-5">
                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-[13px] text-[#7b7063]">{footerHint}</div>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <button
                        type="button"
                        onClick={onClose}
                        className="inline-flex w-full items-center justify-center rounded-[14px] border border-[#ddd5c8] px-5 py-3 text-[14px] font-semibold text-[#4e453b] transition hover:bg-white sm:w-auto"
                      >
                        Close
                      </button>
                      <button
                        type="submit"
                        disabled={!canSubmit}
                        className="inline-flex w-full items-center justify-center gap-2 justify-center rounded-[14px] bg-[#41695b] px-5 py-3 text-[14px] font-semibold text-white shadow-[0_18px_32px_-18px_rgba(54,88,75,0.5)] transition hover:bg-[#35584b] disabled:cursor-not-allowed disabled:bg-[#b7b0a7] disabled:shadow-none sm:w-auto"
                      >
                        <span>{submitting ? "Submitting..." : "Submit feedback"}</span>
                        <ArrowRightIcon className="h-[18px] w-[18px]" />
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function LanguagePanel({
  selectedLanguage,
  onSelect,
  heading,
  showHeading = true,
  compact = false,
}: {
  selectedLanguage: LanguageCode;
  onSelect: (code: LanguageCode) => void;
  heading: string;
  showHeading?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={cx(
        "w-full max-w-full overflow-hidden border border-[#ece6db] bg-white shadow-[0_28px_54px_-34px_rgba(31,24,16,0.36)]",
        compact ? "rounded-[22px] p-2.5" : "rounded-[22px] p-3 sm:p-4"
      )}
    >
      {showHeading ? (
        <div className="px-2 pb-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6f7d74] sm:text-[12px]">{heading}</div>
      ) : null}
      <div
        role="listbox"
        aria-label={heading}
        className={cx(
          "space-y-1 overflow-y-auto overscroll-contain pr-1",
          compact ? "max-h-[min(46svh,20rem)]" : "max-h-[min(52svh,28rem)]"
        )}
      >
        {LANGUAGE_OPTIONS.map((language) => {
          const active = selectedLanguage === language.code;
          return (
            <button
              key={language.code}
              type="button"
              role="option"
              aria-selected={active}
              lang={language.locale}
              dir={language.dir}
              onClick={() => onSelect(language.code)}
              className={cx(
                "flex w-full items-center justify-between gap-3 text-left transition",
                compact ? "rounded-[15px] px-3 py-2.5" : "rounded-[16px] px-3.5 py-2.5 sm:px-4 sm:py-3",
                active ? "bg-[#edf5c7] text-[#41695b]" : "text-[#3b3025] hover:bg-[#f7f4ed]"
              )}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className={cx("leading-none", compact ? "text-[20px]" : "text-[21px] sm:text-[22px]")}>{language.flag}</span>
                <div className="min-w-0">
                  <div
                    className={cx(
                      "truncate font-semibold",
                      compact ? "text-[14px]" : "text-[14px] sm:text-[15px]",
                      active ? "text-[#41695b]" : "text-[#2e261e]"
                    )}
                  >
                    {language.nativeName}
                  </div>
                </div>
              </div>
              <span className={cx("h-2.5 w-2.5 rounded-full", active ? "bg-[#8d6720]" : "bg-transparent")} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LanguagePickerDialog({
  selectedLanguage,
  heading,
  onSelect,
  onClose,
}: {
  selectedLanguage: LanguageCode;
  heading: string;
  onSelect: (code: LanguageCode) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-5">
      <button
        type="button"
        aria-label="Close language picker"
        className="absolute inset-0 bg-[#1f1a14]/36 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dashboard-language-title"
        className="relative z-10 w-full max-w-[560px] overflow-hidden rounded-t-[30px] border border-[#e8e1d4] bg-[#fcfaf4] p-4 shadow-[0_40px_90px_-44px_rgba(27,40,31,0.34)] sm:rounded-[24px] sm:p-5"
      >
        <div className="pointer-events-none flex justify-center pb-3 sm:hidden">
          <div className="h-1.5 w-12 rounded-full bg-[#ddd3c2]" />
        </div>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full bg-[#f2f5ec] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#78866f]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#98bf62]" />
              Dashboard
            </div>
            <h2 id="dashboard-language-title" className="mt-3 text-[24px] font-semibold tracking-[-0.04em] text-[#1c1814]">
              {heading}
            </h2>
            <p className="mt-1 text-[13px] leading-5 text-[#756e63]">Choose the dashboard language for navigation, labels, and date formatting.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#e6decd] bg-white text-[#61584c] transition hover:bg-[#f8f4ea]"
            aria-label="Close language picker"
          >
            <CloseIcon className="h-[18px] w-[18px]" />
          </button>
        </div>
        <LanguagePanel
          selectedLanguage={selectedLanguage}
          onSelect={(code) => {
            onSelect(code);
            onClose();
          }}
          heading={heading}
          showHeading={false}
        />
      </div>
    </div>,
    document.body
  );
}

function DashboardLocationFilter({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (location: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeValue = options.includes(value) ? value : options[0] ?? value;

  useEffect(() => {
    if (!open || typeof document === "undefined") return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (containerRef.current?.contains(target)) return;
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Filter by region"
        onClick={() => setOpen((current) => !current)}
        className={cx(
          "group relative flex h-11 w-full items-center rounded-lg border border-[#d9ddd8] bg-white pl-10 pr-10 text-left shadow-[0_1px_2px_rgba(26,32,28,0.04)] outline-none transition hover:border-[#c9cec9] focus-visible:border-[#7fa58c] focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/20",
          open ? "border-[#7fa58c] ring-2 ring-[#2e7d4f]/20" : ""
        )}
      >
        <LocationPinIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7a827c]" />
        <span className="truncate text-[14px] font-medium text-[#1a201c]">{activeValue}</span>
        <ChevronDownIcon
          className={cx(
            "pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7a827c] transition-transform duration-200",
            open ? "rotate-180" : ""
          )}
        />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.375rem)] z-30">
          <div className="dashboard-menu-pop overflow-hidden rounded-xl border border-[#e3e5e1] bg-white p-1.5 shadow-[0_16px_40px_-12px_rgba(15,20,17,0.28)]">
            <div role="listbox" aria-label="Select region" className="sidebar-scrollbar max-h-[min(44svh,18rem)] space-y-1 overflow-y-auto overscroll-contain pr-1">
              {options.map((location) => {
                const active = activeValue === location;
                return (
                  <button
                    key={location}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      onChange(location);
                      setOpen(false);
                    }}
                    className={cx(
                      "flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left text-[14px] transition",
                      active ? "bg-[#eceeea] text-[#1a201c]" : "text-[#3b443e] hover:bg-[#f3f4f1]"
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <LocationPinIcon className={cx("h-4 w-4 shrink-0", active ? "text-[#1a201c]" : "text-[#9aa29c]")} />
                      <span className="truncate font-medium">{location}</span>
                    </span>
                    <span
                      className={cx(
                        "inline-flex h-6 w-6 shrink-0 items-center justify-center transition",
                        active ? "text-[#2e7d4f]" : "text-transparent"
                      )}
                    >
                      <CheckIcon className="h-4 w-4" />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DashboardPageShell({
  currentSection,
  setCurrentSection,
  profileName,
  profileEmail,
  profileRole,
  profileSyncLabel,
  workerId,
  language,
  setLanguage,
  strings,
  loading,
  onLogout,
  navBadges,
  walletSummary,
  liveStatus,
  onGlobalSearch,
  children,
}: {
  currentSection: DashboardSection;
  setCurrentSection: (next: DashboardSection) => void;
  profileName: string;
  profileEmail: string;
  profileRole: string;
  profileSyncLabel: string;
  workerId: string | null;
  language: LanguageOption;
  setLanguage: (code: LanguageCode) => void;
  strings: DashboardStrings;
  loading: boolean;
  onLogout: () => void | Promise<void>;
  navBadges?: Partial<Record<DashboardSection, number>>;
  walletSummary?: { credited: number; pending: number; estimated?: boolean; walletVerified?: boolean; loading?: boolean; unavailable?: boolean };
  liveStatus?: { syncing: boolean; lastSyncedAt: number | null; saved?: boolean; onSync: () => void };
  onGlobalSearch?: (query: string) => void;
  children: ReactNode;
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [globalQuery, setGlobalQuery] = useState("");
  const shortcutLabel = useSyncExternalStore(subscribeNoop, readShortcutLabel, () => "⌘K");
  const globalSearchRef = useRef<HTMLInputElement | null>(null);
  const drawerCloseRef = useRef<HTMLButtonElement | null>(null);
  const drawerToggleRef = useRef<HTMLButtonElement | null>(null);
  const drawerTouchStartRef = useRef<{ x: number; y: number; axis: "x" | "y" | null } | null>(null);
  const [drawerDragX, setDrawerDragX] = useState(0);
  const drawerOnline = useSyncExternalStore(subscribeOnline, readOnline, () => true);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      if (!globalSearchRef.current || globalSearchRef.current.offsetParent === null) return;
      event.preventDefault();
      globalSearchRef.current.focus();
      globalSearchRef.current.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [mobileMenuVisible, setMobileMenuVisible] = useState(false);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  // Desktop sidebar collapse, remembered per browser. The server snapshot is "expanded" so hydration stays stable.
  const desktopCollapsed = useSyncExternalStore(subscribeSidebarCollapsed, readSidebarCollapsed, () => false);
  const mobileMenuCloseTimerRef = useRef<number | null>(null);
  const toggleDesktopSidebar = useCallback(() => {
    writeSidebarCollapsed(!readSidebarCollapsed());
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "b") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      if (window.innerWidth < 1280) return;
      event.preventDefault();
      toggleDesktopSidebar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleDesktopSidebar]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = mobileMenuVisible || feedbackOpen || languageMenuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [feedbackOpen, languageMenuOpen, mobileMenuVisible]);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && mobileMenuCloseTimerRef.current !== null) {
        window.clearTimeout(mobileMenuCloseTimerRef.current);
      }
    };
  }, []);

  const initials = getInitials(profileName, 1);
  const activeSectionLabel = strings.nav[currentSection];
  const SectionIcon = NAV_ITEMS.find((item) => item.id === currentSection)?.icon ?? ProfileIcon;
  const greeting = useSyncExternalStore(subscribeNoop, readGreeting, () => "Welcome back");
  const greetingName = /@/.test(profileName) ? "" : profileName.trim().split(/\s+/)[0] ?? "";
  const profileActive = currentSection === "profile";
  const footerMeta = profileEmail && profileEmail !== "No email on file" ? profileEmail : profileRole;

  const openMobileMenu = useCallback(() => {
    if (typeof window !== "undefined" && mobileMenuCloseTimerRef.current !== null) {
      window.clearTimeout(mobileMenuCloseTimerRef.current);
      mobileMenuCloseTimerRef.current = null;
    }
    setLanguageMenuOpen(false);
    setMobileMenuVisible(true);
    if (typeof window === "undefined") {
      setMobileMenuOpen(true);
      return;
    }
    window.requestAnimationFrame(() => setMobileMenuOpen(true));
  }, []);

  const closeMobileMenu = useCallback(() => {
    setMobileMenuOpen(false);
    setLanguageMenuOpen(false);
    if (!mobileMenuVisible) {
      setMobileMenuVisible(false);
      return;
    }
    if (typeof window === "undefined") {
      setMobileMenuVisible(false);
      return;
    }
    if (mobileMenuCloseTimerRef.current !== null) {
      window.clearTimeout(mobileMenuCloseTimerRef.current);
    }
    mobileMenuCloseTimerRef.current = window.setTimeout(() => {
      setMobileMenuVisible(false);
      mobileMenuCloseTimerRef.current = null;
    }, 320);
  }, [mobileMenuVisible]);

  // Drawer: move focus in on open, back to the toggle on close, and close on Escape.
  const drawerWasOpenRef = useRef(false);
  useEffect(() => {
    if (mobileMenuOpen) {
      drawerWasOpenRef.current = true;
      drawerCloseRef.current?.focus({ preventScroll: true });
      const onKey = (event: KeyboardEvent) => {
        if (event.key === "Escape" && !languageMenuOpen && !feedbackOpen) closeMobileMenu();
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
    if (drawerWasOpenRef.current) {
      drawerWasOpenRef.current = false;
      drawerToggleRef.current?.focus({ preventScroll: true });
    }
  }, [closeMobileMenu, feedbackOpen, languageMenuOpen, mobileMenuOpen]);

  const handleFeedbackClick = () => {
    setLanguageMenuOpen(false);
    closeMobileMenu();
    setFeedbackOpen(true);
  };

  const handleSectionChange = (next: DashboardSection) => {
    setLanguageMenuOpen(false);
    writeDashboardSectionToUrl(next);
    startTransition(() => {
      setCurrentSection(next);
      closeMobileMenu();
    });
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    }
  };

  const handleLogout = async () => {
    if (logoutPending) return;
    setLanguageMenuOpen(false);
    setFeedbackOpen(false);
    setLogoutPending(true);
    try {
      await onLogout();
    } catch {
      setLogoutPending(false);
    }
  };

  return (
    <div
      className="creator-dashboard-theme relative min-h-screen overflow-x-clip bg-[#f8f4ec] text-[#20352c] [font-family:var(--font-geist-sans)]"
      dir={language.dir}
      lang={language.locale}
      suppressHydrationWarning
    >
      {languageMenuOpen ? (
        <LanguagePickerDialog
          selectedLanguage={language.code}
          heading={strings.shell.language}
          onSelect={setLanguage}
          onClose={() => setLanguageMenuOpen(false)}
        />
      ) : null}

      {feedbackOpen ? (
        <FeedbackComposer
          onClose={() => setFeedbackOpen(false)}
          profileName={profileName}
          profileRole={profileRole}
          sectionLabel={activeSectionLabel}
          language={language}
          workerId={workerId}
        />
      ) : null}

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="dashboard-ambient-grid absolute inset-0 opacity-60" />
        <div className="dashboard-bg-orb dashboard-bg-orb--warm absolute left-[-5rem] top-[4rem] h-[14rem] w-[14rem] md:left-[-7rem] md:top-[5rem] md:h-[22rem] md:w-[22rem]" />
        <div className="dashboard-bg-orb dashboard-bg-orb--sand absolute right-[-4rem] top-[16rem] h-[13rem] w-[13rem] md:right-[-6rem] md:top-[20rem] md:h-[20rem] md:w-[20rem]" style={{ animationDelay: "-6s" }} />
        <div className="dashboard-bg-orb dashboard-bg-orb--light absolute bottom-[8rem] left-[12%] h-[12rem] w-[12rem] md:bottom-[4rem] md:h-[18rem] md:w-[18rem]" style={{ animationDelay: "-11s" }} />
      </div>

      <div className="relative flex min-h-screen">
        {/* Tablet / small laptop: icon rail */}
        <aside className={cx("sticky top-0 z-20 hidden h-screen w-[72px] shrink-0 flex-col items-center border-r border-[#e3e5e1] bg-white py-3 md:flex", !desktopCollapsed && "xl:hidden")}>
          <div className="flex h-[44px] items-center">
            <Link
              href="/"
              aria-label="Reelencer home"
              className={cx(
                "flex h-10 w-10 items-center justify-center rounded-lg transition hover:bg-[#f3f4f1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40",
                desktopCollapsed && "xl:hidden"
              )}
            >
              <BrandMark className="h-8 w-8" />
            </Link>
            {desktopCollapsed ? (
              <button
                type="button"
                onClick={toggleDesktopSidebar}
                title="Expand sidebar (Ctrl/⌘ B)"
                aria-label="Expand sidebar"
                className="group/expand relative hidden h-10 w-10 items-center justify-center rounded-lg text-[#4b544e] transition hover:bg-[#f3f4f1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40 xl:flex"
              >
                <BrandMark className="h-8 w-8 transition-opacity group-hover/expand:opacity-0 group-focus-visible/expand:opacity-0" />
                <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover/expand:opacity-100 group-focus-visible/expand:opacity-100">
                  <SidebarToggleIcon collapsed />
                </span>
              </button>
            ) : null}
          </div>
          <nav aria-label="Dashboard sections" className="mt-5 flex flex-col items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <RailNavItem
                key={item.id}
                icon={item.icon}
                label={strings.nav[item.id]}
                active={currentSection === item.id}
                badge={navBadges?.[item.id] ?? 0}
                onClick={() => handleSectionChange(item.id)}
              />
            ))}
          </nav>
          <div className="mt-auto flex flex-col items-center gap-1.5">
            <SidebarAccountMenu
                variant="rail"
                initials={initials}
                name={profileName}
                meta={footerMeta}
                role={profileRole}
                active={profileActive}
                languageLabel={language.nativeName}
                languageFlag={language.flag}
                feedbackLabel={strings.shell.feedback}
                logoutPending={logoutPending}
                onProfile={() => handleSectionChange("profile")}
                onLanguage={() => setLanguageMenuOpen(true)}
                onFeedback={handleFeedbackClick}
                onLogout={handleLogout}
            />
          </div>
        </aside>

        {/* Desktop sidebar */}
        <aside className={cx("sticky top-0 z-20 hidden h-screen w-[248px] shrink-0 flex-col border-r border-[#e3e5e1] bg-white 2xl:w-[264px]", !desktopCollapsed && "xl:flex")}>
          <div className="group/brand flex h-[68px] shrink-0 items-center justify-between gap-2 border-b border-[#ebedea] px-3">
            <BrandLockup />
            <button
              type="button"
              onClick={toggleDesktopSidebar}
              title="Collapse sidebar (Ctrl/⌘ B)"
              aria-label="Collapse sidebar"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#7a827c] transition hover:bg-[#f3f4f1] hover:text-[#1a201c] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/brand:opacity-100"
            >
              <SidebarToggleIcon />
            </button>
          </div>

          <div className="sidebar-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            <nav aria-label="Dashboard sections" className="space-y-5 pt-4">
              {[
                { label: "Work", ids: ["jobs", "dashboard", "find", "accounts"] },
                { label: "Earnings & updates", ids: ["messages", "wallet"] },
              ].map((group) => (
                <div key={group.label}>
                  <div className="px-2.5 pb-1 text-[11.5px] font-semibold text-[#7a827c]">{group.label}</div>
                  <div className="grid gap-0.5">
                    {NAV_ITEMS.filter((item) => group.ids.includes(item.id)).map((item) => (
                      <SidebarNavItem
                        key={item.id}
                        icon={item.icon}
                        label={strings.nav[item.id]}
                        active={currentSection === item.id}
                        badge={navBadges?.[item.id] ?? 0}
                        onClick={() => handleSectionChange(item.id)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </nav>

            {walletSummary && currentSection !== "wallet" ? (
              <button
                type="button"
                onClick={() => handleSectionChange("wallet")}
                className="group mt-6 block w-full rounded-xl border border-[#e3e5e1] bg-[#fafbf9] p-3 text-left transition hover:border-[#cfd5cf] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40"
              >
                <span className="flex items-center justify-between text-[12px] text-[#616a64]">
                  {walletSummary.estimated ? "Pending earnings" : "Pending payout"}
                  <ArrowRightIcon className="h-3.5 w-3.5 text-[#8a928c] transition group-hover:translate-x-0.5 group-hover:text-[#1a201c]" />
                </span>
                <span className="mt-0.5 block break-words text-[19px] font-semibold leading-tight text-[#1a201c] tabular-nums" aria-live="polite">{walletSummary.loading ? <span className="block h-6 w-24 animate-pulse rounded bg-[#e7ebe5]" /> : walletSummary.unavailable ? "–" : formatINR(walletSummary.pending)}</span>
                <span className="mt-2.5 flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full bg-[#eef0ed]" aria-hidden="true">
                  {walletSummary.credited > 0 ? (
                    <span className="h-full rounded-l-full bg-[#2e7d4f]" style={{ width: `${(walletSummary.credited / Math.max(Number.EPSILON, walletSummary.credited + walletSummary.pending)) * 100}%` }} />
                  ) : null}
                  {walletSummary.pending > 0 ? <span className="h-full flex-1 rounded-r-full bg-[#7cb68a]" /> : null}
                </span>
                <span className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11.5px] text-[#7a827c]">
                  <span className="inline-flex flex-wrap items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#2e7d4f]" aria-hidden="true" />
                    {walletSummary.estimated ? walletSummary.walletVerified ? "Credited" : "Approved estimate" : "Paid out"} {walletSummary.loading || walletSummary.unavailable ? "–" : formatINR(walletSummary.credited)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#7cb68a]" aria-hidden="true" />
                    Pending
                  </span>
                </span>
                {walletSummary.estimated ? <span className="mt-1 block text-[10.5px] text-[#8a928c]">{walletSummary.walletVerified ? "Approved earnings added to your wallet" : "Estimate from your linked accounts"}</span> : null}
                {walletSummary.unavailable ? <span className="mt-1 block text-[10.5px] text-[#8a5300]">Earnings couldn’t be refreshed</span> : null}
              </button>
            ) : null}
          </div>

          <div className="shrink-0 border-t border-[#ebedea] p-2">
            <SidebarAccountMenu
                variant="full"
                initials={initials}
                name={profileName}
                meta={footerMeta}
                role={profileRole}
                active={profileActive}
                languageLabel={language.nativeName}
                languageFlag={language.flag}
                feedbackLabel={strings.shell.feedback}
                logoutPending={logoutPending}
                onProfile={() => handleSectionChange("profile")}
                onLanguage={() => setLanguageMenuOpen(true)}
                onFeedback={handleFeedbackClick}
                onLogout={handleLogout}
            />
          </div>
        </aside>

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-[#e6ebe2] bg-[#fcfdf9]/90 backdrop-blur-md">
            <div className="flex h-[60px] items-center justify-between gap-3 px-3.5 sm:px-5 md:h-[68px] md:px-6 lg:px-7 2xl:px-8">
              <div className="md:hidden">
                <MobileMenuToggleButton
                  open={mobileMenuOpen}
                  label={mobileMenuOpen ? "Close navigation" : "Open navigation"}
                  onClick={mobileMenuOpen ? closeMobileMenu : openMobileMenu}
                  buttonRef={drawerToggleRef}
                />
              </div>

              {/* Section identity: its nav icon + a personal greeting above the title (no more "Dashboard / Dashboard"). */}
              <div className="flex min-w-0 items-center justify-center gap-2.5 md:justify-start md:gap-3">
                <span
                  aria-hidden="true"
                  key={currentSection}
                  className="section-swipe-settle hidden h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border border-[#dfe9da] bg-[linear-gradient(160deg,#f3f9ef,#e6f2e0)] text-[#2e7d4f] shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_1px_2px_rgba(34,45,37,0.06)] md:flex"
                >
                  <SectionIcon className="h-[19px] w-[19px]" />
                </span>
                <div className="min-w-0 text-center md:text-left">
                  <div className="hidden truncate text-[11.5px] font-semibold text-[#7a877f] md:block">
                    {greeting}
                    {greetingName ? <span className="text-[#41695b]">, {greetingName}</span> : null}
                  </div>
                  <h1 className="flex min-w-0 items-center justify-center gap-1.5 truncate text-[16px] font-semibold text-[#20352c] md:justify-start md:text-[20px] md:leading-tight md:tracking-[-0.02em]">
                    <SectionIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-[#2e7d4f] md:hidden" />
                    <span className="truncate">{activeSectionLabel}</span>
                  </h1>
                </div>
              </div>

              {onGlobalSearch ? (
                <form
                  role="search"
                  onSubmit={(event) => {
                    event.preventDefault();
                    onGlobalSearch(globalQuery.trim());
                    globalSearchRef.current?.blur();
                  }}
                  className="hidden min-w-0 flex-1 justify-center px-2 md:flex"
                >
                  <label className="relative w-full max-w-[480px]">
                    <span className="sr-only">Search gigs, brands, or platforms</span>
                    <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7a827c]" />
                    <input
                      ref={globalSearchRef}
                      type="search"
                      value={globalQuery}
                      onChange={(event) => setGlobalQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setGlobalQuery("");
                          event.currentTarget.blur();
                        }
                      }}
                      placeholder="Search gigs or brands"
                      enterKeyHint="search"
                      className="peer h-9 w-full rounded-lg border border-[#e3e5e1] bg-[#f3f4f1] pl-9 pr-3 lg:pr-16 text-[13.5px] text-[#1a201c] outline-none transition placeholder:text-[#7a827c] hover:border-[#d3d7d2] focus:border-[#7fa58c] focus:bg-white focus:ring-2 focus:ring-[#2e7d4f]/20"
                    />
                    <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-md border border-[#dfe2de] bg-white px-1.5 py-0.5 font-sans text-[11px] font-medium text-[#7a827c] lg:block lg:peer-focus:hidden">
                      {shortcutLabel}
                    </kbd>
                  </label>
                </form>
              ) : null}

              <div className="flex shrink-0 items-center gap-2">
                <LiveSyncPill
                  loading={loading}
                  syncing={liveStatus?.syncing ?? false}
                  lastSyncedAt={liveStatus?.lastSyncedAt ?? null}
                  onSync={liveStatus?.onSync}
                  loadingLabel={strings.shell.syncingData}
                  saved={liveStatus?.saved}
                />
                {currentSection !== "find" ? (
                  <button
                    type="button"
                    onClick={() => handleSectionChange("find")}
                    className="hidden h-9 items-center gap-1.5 rounded-lg bg-[#1f2b24] px-3.5 text-[13px] font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition hover:bg-[#2b3a31] xl:inline-flex"
                  >
                    <SearchIcon className="h-4 w-4" />
                    Find gigs
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => handleSectionChange("messages")}
                  aria-label={`Messages${navBadges?.messages ? `, ${navBadges.messages} unread` : ""}`}
                  className="relative hidden h-10 w-10 items-center justify-center rounded-full border border-[#e6ebe2] bg-white text-[#41695b] transition hover:bg-[#f4f7f1] md:flex"
                >
                  <MessagesIcon className="h-[18px] w-[18px]" />
                  {navBadges?.messages ? (
                    <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-white bg-[#c2410c] px-1 text-[9.5px] font-bold text-white">
                      {navBadges.messages > 9 ? "9+" : navBadges.messages}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={() => handleSectionChange("profile")}
                  className={cx(
                    "flex h-10 w-10 items-center justify-center rounded-full text-[14px] font-bold transition active:scale-[0.97] xl:hidden",
                    profileActive ? "bg-[#2e7d4f] text-white" : "bg-[#1f2b24] text-white"
                  )}
                  aria-label={strings.nav.profile}
                >
                  {initials}
                </button>
              </div>
            </div>
          </header>

          {mobileMenuVisible ? (
            <div className="fixed inset-0 z-40 flex md:hidden" role="presentation">
              <button
                type="button"
                tabIndex={-1}
                className={cx(
                  "absolute inset-0 transition-opacity duration-300 ease-out motion-reduce:transition-none",
                  mobileMenuOpen ? "bg-[#0f1411]/45 opacity-100 backdrop-blur-[2px]" : "bg-[#0f1411]/0 opacity-0"
                )}
                aria-label="Close navigation"
                onClick={closeMobileMenu}
              />
              <div
                id="dashboard-mobile-menu"
                role="dialog"
                aria-modal="true"
                aria-label="Navigation"
                onTouchStart={(event) => {
                  const touch = event.touches[0];
                  drawerTouchStartRef.current = touch ? { x: touch.clientX, y: touch.clientY, axis: null } : null;
                }}
                onTouchMove={(event) => {
                  const start = drawerTouchStartRef.current;
                  const touch = event.touches[0];
                  if (!start || !touch) return;
                  const dx = touch.clientX - start.x;
                  const dy = touch.clientY - start.y;
                  if (!start.axis && Math.abs(dx) + Math.abs(dy) > 8) start.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
                  if (start.axis === "x") setDrawerDragX(Math.min(0, dx));
                }}
                onTouchEnd={() => {
                  if (drawerDragX < -72) closeMobileMenu();
                  setDrawerDragX(0);
                  drawerTouchStartRef.current = null;
                }}
                style={drawerDragX ? { transform: `translateX(${drawerDragX}px)`, transition: "none" } : undefined}
                className={cx(
                  "relative z-10 flex h-full w-[min(340px,88vw)] flex-col bg-white shadow-[12px_0_40px_-12px_rgba(15,20,17,0.35)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform motion-reduce:transition-none",
                  mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
                )}
              >
                {/* Header */}
                <div className="shrink-0 border-b border-[#ebedea]" style={{ paddingTop: "env(safe-area-inset-top)" }}>
                  <div className="flex h-[60px] items-center justify-between gap-2 pl-2.5 pr-3">
                    <BrandLockup />
                    <button
                      ref={drawerCloseRef}
                      type="button"
                      onClick={closeMobileMenu}
                      aria-label="Close navigation"
                      aria-controls="dashboard-mobile-menu"
                      title="Close (Esc)"
                      className="flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-full bg-[#f3f4f1] text-[#1a201c] transition hover:bg-[#e9ebe7] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40"
                    >
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-[18px] w-[18px]" aria-hidden="true">
                        <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="sidebar-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
                  {/* Account */}
                  <div className="px-3 pt-3">
                    <button
                      type="button"
                      onClick={() => handleSectionChange("profile")}
                      aria-current={profileActive ? "page" : undefined}
                      className={cx(
                        "group/acct flex w-full items-center gap-3 rounded-2xl p-3 text-left ring-1 ring-inset transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40 motion-reduce:active:scale-100",
                        profileActive ? "bg-[#eef3ec] ring-[#cfe3d4]" : "bg-[#fafbf9] ring-[#ebedea] active:bg-[#f3f4f1]"
                      )}
                    >
                      <span
                        className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(145deg,#2b3d32,#1a241e)] text-[16px] font-semibold text-white shadow-[0_4px_10px_-4px_rgba(26,36,30,0.6)]"
                        aria-hidden="true"
                      >
                        {initials}
                        <span className={cx("absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-[2.5px] border-white", drawerOnline ? "bg-[#2e7d4f]" : "bg-[#b9c0ba]")} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-[15px] font-semibold text-[#1a201c]">{profileName}</span>
                          <span className="shrink-0 rounded-full bg-white px-1.5 py-px text-[10.5px] font-semibold text-[#2b5d4a] ring-1 ring-inset ring-[#d6e6d9]">{profileRole}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-[12.5px] text-[#616a64]" title={footerMeta}>
                          {footerMeta}
                        </span>
                      </span>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#7a827c] transition group-active/acct:bg-white" aria-hidden="true">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                          <path d="m8 5 5 5-5 5" />
                        </svg>
                      </span>
                      <span className="sr-only">Open your profile</span>
                    </button>
                  </div>

                  {/* Search */}
                  {onGlobalSearch ? (
                    <form
                      role="search"
                      onSubmit={(event) => {
                        event.preventDefault();
                        onGlobalSearch(globalQuery.trim());
                        closeMobileMenu();
                      }}
                      className="px-3 pt-3"
                    >
                      <label className="group/search relative block">
                        <span className="sr-only">Search gigs, brands, or platforms</span>
                        <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7a827c] transition group-focus-within/search:text-[#2e7d4f]" />
                        <input
                          type="search"
                          value={globalQuery}
                          onChange={(event) => setGlobalQuery(event.target.value)}
                          placeholder="Search gigs and brands"
                          enterKeyHint="search"
                          autoComplete="off"
                          className={cx(
                            "h-12 w-full rounded-xl border border-[#e3e5e1] bg-[#f5f6f3] pl-10 text-[16px] text-[#1a201c] outline-none transition placeholder:text-[#8a928c] focus:border-[#7fa58c] focus:bg-white focus:ring-4 focus:ring-[#2e7d4f]/10 [&::-webkit-search-cancel-button]:hidden",
                            globalQuery ? "pr-[5.5rem]" : "pr-3"
                          )}
                        />
                        {globalQuery ? (
                          <span className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setGlobalQuery("")}
                              aria-label="Clear search"
                              className="flex h-9 w-9 items-center justify-center rounded-lg text-[#7a827c] transition active:bg-[#eef0ec]"
                            >
                              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4" aria-hidden="true">
                                <path d="m6 6 8 8M14 6l-8 8" />
                              </svg>
                            </button>
                            <button
                              type="submit"
                              aria-label="Search"
                              className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1f2b24] text-white transition active:scale-95"
                            >
                              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                                <path d="M4.5 10h11M11 5.5l4.5 4.5-4.5 4.5" />
                              </svg>
                            </button>
                          </span>
                        ) : null}
                      </label>
                    </form>
                  ) : null}

                  {/* Navigation */}
                  <nav aria-label="Dashboard sections" className="space-y-4 px-2 py-3">
                    {[
                      { label: "Work", ids: ["jobs", "dashboard", "find", "accounts"] },
                      { label: "Earnings & updates", ids: ["messages", "wallet"] },
                    ].map((group, groupIndex) => (
                      <div key={group.label}>
                        <div className="px-3 pb-1 text-[11.5px] font-semibold text-[#7a827c]">{group.label}</div>
                        <ul>
                          {NAV_ITEMS.filter((item) => group.ids.includes(item.id)).map((item, index) => {
                            const ItemIcon = item.icon;
                            const active = currentSection === item.id;
                            const badge = navBadges?.[item.id] ?? 0;
                            return (
                              <li
                                key={item.id}
                                className={cx(
                                  "transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none",
                                  mobileMenuOpen ? "translate-x-0 opacity-100" : "-translate-x-2 opacity-0"
                                )}
                                style={{ transitionDelay: mobileMenuOpen ? `${80 + (groupIndex * 3 + index) * 30}ms` : "0ms" }}
                              >
                                <button
                                  type="button"
                                  onClick={() => handleSectionChange(item.id)}
                                  aria-current={active ? "page" : undefined}
                                  className={cx(
                                    "relative flex h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40",
                                    active ? "bg-[#eceeea] text-[#1a201c]" : "text-[#3b443e] active:bg-[#f3f4f1]"
                                  )}
                                >
                                  {active ? <span className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-[#1f2b24]" aria-hidden="true" /> : null}
                                  <ItemIcon className={cx("h-5 w-5 shrink-0", active ? "text-[#1a201c]" : "text-[#7a827c]")} />
                                  <span className="min-w-0 flex-1 truncate">{strings.nav[item.id]}</span>
                                  {badge > 0 ? (
                                    <span className="rounded-full bg-[#c2410c] px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white tabular-nums" aria-label={`${badge} unread`}>
                                      {badge > 99 ? "99+" : badge}
                                    </span>
                                  ) : null}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </nav>

                  {/* Payout */}
                  {walletSummary ? (
                    <div className="px-4 pb-4">
                      <button
                        type="button"
                        onClick={() => handleSectionChange("wallet")}
                        className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-xl border border-[#e3e5e1] bg-[#fafbf9] p-3.5 text-left transition active:bg-[#f3f4f1]"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-[#2b5d4a] ring-1 ring-[#e3e5e1]">
                          <WalletIcon className="h-[18px] w-[18px]" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12px] text-[#616a64]">{walletSummary.estimated ? "Pending earnings" : "Pending payout"}</span>
                          <span className="block break-words text-[16px] font-semibold text-[#1a201c] tabular-nums">{walletSummary.loading || walletSummary.unavailable ? "–" : formatINR(walletSummary.pending)}</span>
                        </span>
                        <span className="col-start-2 min-w-0 text-[11.5px] text-[#7a827c]">
                          {walletSummary.estimated ? walletSummary.walletVerified ? "Credited" : "Approved estimate" : "Paid out"}
                          <span className="ml-2 break-words text-[12.5px] font-semibold text-[#1a201c] tabular-nums">{walletSummary.loading || walletSummary.unavailable ? "–" : formatINR(walletSummary.credited)}</span>
                          {walletSummary.estimated ? <span className="mt-1 block text-[10.5px]">{walletSummary.walletVerified ? "Approved earnings added to your wallet" : "Estimate from your linked accounts"}</span> : null}
                        </span>
                      </button>
                    </div>
                  ) : null}
                </div>

                {/* Footer */}
                <div className="border-t border-[#ebedea] px-3 pt-2.5" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      data-language-trigger="true"
                      onClick={() => setLanguageMenuOpen((value) => !value)}
                      aria-haspopup="listbox"
                      aria-expanded={languageMenuOpen}
                      className="flex h-11 flex-col items-center justify-center rounded-lg text-[11px] font-semibold text-[#4b544e] transition active:bg-[#f3f4f1]"
                    >
                      <span className="text-[15px] leading-none">{language.flag}</span>
                      <span className="mt-0.5 uppercase">{language.code}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleFeedbackClick}
                      className="flex h-11 flex-col items-center justify-center rounded-lg text-[11px] font-semibold text-[#4b544e] transition active:bg-[#f3f4f1]"
                    >
                      <MessagesIcon className="h-4 w-4" />
                      <span className="mt-0.5">{strings.shell.feedback}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleLogout}
                      disabled={logoutPending}
                      className="flex h-11 flex-col items-center justify-center rounded-lg text-[11px] font-semibold text-[#b42318] transition active:bg-[#fdf2f1] disabled:opacity-50"
                    >
                      <LogoutIcon className="h-4 w-4" />
                      <span className="mt-0.5">{logoutPending ? "Signing out…" : "Sign out"}</span>
                    </button>
                  </div>
                  <div className="mt-1.5 flex items-center justify-center gap-1.5 text-[11.5px] text-[#7a827c]">
                    <span className={cx("h-1.5 w-1.5 rounded-full", loading || liveStatus?.syncing ? "animate-pulse bg-[#d99a06]" : "bg-[#2e7d4f]")} aria-hidden="true" />
                    {loading ? strings.shell.syncingData : liveStatus?.saved ? "Showing saved data" : liveStatus?.syncing ? "Syncing…" : profileSyncLabel}
                    {workerId ? <span className="font-mono">· {workerId}</span> : null}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <main className="flex-1 px-3.5 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4 min-[380px]:px-4 sm:px-5 sm:pt-5 md:px-6 md:pb-9 lg:px-7 xl:px-7 xl:pb-10 xl:pt-7 2xl:px-8">
            {children}
          </main>

          {/* Phones: one-tap section switching */}
          <nav
            aria-label="Dashboard sections"
            className="dashboard-tabbar fixed inset-x-0 bottom-0 z-30 border-t border-[#e3e5e1] bg-white/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 shadow-[0_-12px_30px_-18px_rgba(34,45,37,0.28)] backdrop-blur-md md:hidden"
          >
            <ul className="mx-auto grid max-w-md grid-cols-5">
              {/* Five slots: Accounts lives in the menu and sidebar instead. */}
              {NAV_ITEMS.filter((item) => item.id !== "accounts").map((item) => {
                const active = currentSection === item.id;
                const Icon = item.icon;
                const badge = navBadges?.[item.id] ?? 0;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => handleSectionChange(item.id)}
                      aria-current={active ? "page" : undefined}
                      className="group flex w-full flex-col items-center gap-0.5 rounded-[14px] py-1.5 text-[10.5px] font-semibold"
                    >
                      <span
                        className={cx(
                          "relative flex h-8 w-12 items-center justify-center rounded-full transition-all duration-300",
                          active ? "bg-[#e6e9e5] text-[#1a201c]" : "text-[#616a64] group-active:bg-[#f1f3f0]"
                        )}
                      >
                        <Icon className="h-[19px] w-[19px]" />
                        {badge > 0 ? (
                          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-white bg-[#c2410c] px-1 text-[9.5px] font-bold leading-none text-white">
                            {badge > 9 ? "9+" : badge}
                          </span>
                        ) : null}
                      </span>
                      <span className={cx("max-w-full truncate px-0.5", active ? "text-[#243a33]" : "text-[#6f7d74]")}>{strings.nav[item.id]}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const dashboardQuery = useSearchParams()?.toString() ?? "";
  const location = useMemo(() => dashboardLocation(dashboardQuery), [dashboardQuery]);
  const [currentSection, setCurrentSection] = useState<DashboardSection>(location.section);
  const [languageCode, setLanguageCode] = useState<LanguageCode>(() => resolveInitialLanguageCode());
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("Creator");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileRole, setProfileRole] = useState("Creator");
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [workerProfile, setWorkerProfile] = useState<DashboardWorkerProfile | null>(null);
  const [introVideo, setIntroVideo] = useState<IntroVideoMeta | null>(null);
  const [gigs, setGigs] = useState<Gig[]>([]);
  const [gigsLoading, setGigsLoading] = useState(true);
  const [applications, setApplications] = useState<GigApplication[]>([]);
  const [assignments, setAssignments] = useState<GigAssignment[]>([]);
  const [payoutBatches, setPayoutBatches] = useState<PayoutBatch[]>([]);
  // Server wallet balance (available, committed to payouts); null until the first dashboard read.
  const [walletBalance, setWalletBalance] = useState<DashboardWallet | null>(null);
  const socialAccounts = useSocialAccounts(!profileLoading && Boolean(profileUserId || workerId), profileUserId);
  // Linked social accounts + accounts in verification, for the profile's Account card. Both arrive live
  // (social-accounts channel + request refreshes), so links and approvals show up without a reload.
  const linkedAccounts = useMemo(() => (socialAccounts.load.state === "ready" ? socialAccounts.load.accounts : []), [socialAccounts.load]);
  const linkedRequests = useAccountRequests(socialAccounts.load.state === "ready" ? socialAccounts.load.accounts : null, profileUserId);
  const verifyingRequests = useMemo(() => linkedRequests.visible.filter((r) => r.status === "pending" || r.status === "changes_requested"), [linkedRequests.visible]);
  // Minute clock for "New" badges on freshly linked accounts.
  const [minuteNow, setMinuteNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setMinuteNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const accountEarnings = socialAccounts.earnings?.accountCount ? socialAccounts.earnings : null;
  const earningsLoading = socialAccounts.load.state === "loading";
  const earningsError = socialAccounts.load.state === "error" ? socialAccounts.load.message : socialAccounts.load.state === "ready" ? socialAccounts.load.refreshError : undefined;
  const [searchText, setSearchText] = useState("");
  const [platformFilter, setPlatformFilter] = useState("All");
  const [locationFilter, setLocationFilter] = useState("All regions");
  const [selectedGigId, setSelectedGigId] = useState<string | null>(location.intent === "details" ? location.gigId : null);
  const [selectedGigIntent, setSelectedGigIntent] = useState<"details" | "apply">("details");
  const [proposalDeskOpen, setProposalDeskOpen] = useState(false);
  const [proposalPitch, setProposalPitch] = useState("");
  const [proposalTimeline, setProposalTimeline] = useState("");
  const [proposalBudget, setProposalBudget] = useState("");
  const [proposalPortfolio, setProposalPortfolio] = useState("");
  const [proposalSaving, setProposalSaving] = useState(false);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [proposalSuccess, setProposalSuccess] = useState<string | null>(null);
  const [directApplyGigId, setDirectApplyGigId] = useState<string | null>(location.intent === "apply" ? location.gigId : null);
  const [directApplyModalOpen, setDirectApplyModalOpen] = useState(false);
  const [directApplyAgreementChecked, setDirectApplyAgreementChecked] = useState(false);
  const [directApplyError, setDirectApplyError] = useState<string | null>(null);
  const [directApplyAuthEmail, setDirectApplyAuthEmail] = useState("");
  const [directApplyContactLoading, setDirectApplyContactLoading] = useState(false);
  const [directApplyLaunchGigId, setDirectApplyLaunchGigId] = useState<string | null>(location.intent === "apply" ? location.gigId : null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [expandedBriefGigId, setExpandedBriefGigId] = useState<string | null>(null);
  const [copiedGigLinkId, setCopiedGigLinkId] = useState<string | null>(null);
  const [inboxQuery, setInboxQuery] = useState("");
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>("all");
  const [inboxReaderOpen, setInboxReaderOpen] = useState(false);
  const [readThreadKeys, setReadThreadKeys] = useState<string[]>([]);
  const [starredThreadIds, setStarredThreadIds] = useState<string[]>([]);
  const [inboxDetailsOpen, setInboxDetailsOpen] = useState(false);
  const [inboxReferenceCopied, setInboxReferenceCopied] = useState(false);
  const inboxDetailsRef = useRef<HTMLDivElement | null>(null);
  const inboxSearchRef = useRef<HTMLInputElement | null>(null);
  const proposalDeskRef = useRef<HTMLDivElement | null>(null);
  const directApplyDialogRef = useRef<HTMLDivElement | null>(null);
  const [directApplySuccess, setDirectApplySuccess] = useState<{
    /** Email Creator: approved on submit, work starts right away. */
    instant?: boolean;
    /** Content Posting: the account setup comes next, and the sheet opens it after a countdown. */
    setupPlatform?: string;
    gigId: string;
    title: string;
    company: string;
    payout: string;
    payoutType?: string;
    email: string | null;
    emailSent: boolean;
    submittedAt: string;
  } | null>(null);
  const directApplySuccessPrimaryRef = useRef<HTMLButtonElement | null>(null);
  const [proposalReceipt, setProposalReceipt] = useState<{ gigId: string; revision: boolean } | null>(null);
  const proposalSavingRef = useRef(false);

  const deferredSearch = useDeferredValue(searchText);
  const activeLanguage = useMemo(
    () => LANGUAGE_OPTIONS.find((language) => language.code === languageCode) ?? LANGUAGE_OPTIONS[0],
    [languageCode]
  );
  const strings = UI_STRINGS[activeLanguage.code];
  const displayProfileRole = profileRole === "Admin" ? "Admin" : strings.shell.creator;

  useEffect(() => {
    proposalSavingRef.current = proposalSaving;
  }, [proposalSaving]);

  const logout = useCallback(() => {
    if (typeof window === "undefined") return;

    clearDashboardAuthState();

    try {
      const controller = new AbortController();
      window.setTimeout(() => controller.abort(), 1200);
      void fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        signal: controller.signal,
      }).catch(() => null);
    } catch {
      // ignore cleanup failures and continue redirect
    }

    try {
      void supabase.auth.signOut({ scope: "local" }).catch(() => null);
    } catch {
      // ignore cleanup failures and continue redirect
    }

    window.location.replace("/login");
  }, []);
  const openDashboardDestination = useCallback(
    (section: DashboardSection, options?: { gigId?: string | null; intent?: "details" | "apply" }) => {
      if (section === "find" && options?.gigId) {
        setSelectedGigId(String(options.gigId));
        setSelectedGigIntent(options.intent ?? "details");
      } else {
        setSelectedGigId(null);
      }
      setDirectApplyGigId(null);
      setDirectApplyLaunchGigId(null);
      setProposalDeskOpen(false);
      startTransition(() => setCurrentSection(section));
    },
    []
  );

  // URL changes (including Back/Forward) settle before paint, so the previous section never flashes.
  useLayoutEffect(() => {
    setCurrentSection(location.section);
    setSelectedGigId(location.intent === "details" ? location.gigId : null);
    setSelectedGigIntent("details");
    setDirectApplyGigId(location.intent === "apply" ? location.gigId : null);
    setDirectApplyLaunchGigId(location.intent === "apply" ? location.gigId : null);
    setProposalDeskOpen(false);
  }, [location]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(LANGUAGE_STORAGE_KEY, activeLanguage.code);
      } catch {
        // ignore persistence issues
      }
    }
    if (typeof document !== "undefined") {
      document.documentElement.lang = activeLanguage.locale;
      document.documentElement.dir = activeLanguage.dir;
    }
  }, [activeLanguage]);

  const [liveSyncing, setLiveSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [usingSavedData, setUsingSavedData] = useState(false);
  const liveSyncCount = useRef(0);

  const applyDashboard = useCallback((result: Awaited<ReturnType<typeof fetchCreatorDashboard>>) => {
    if (!isCreatorCacheIdentity(result.userId)) return;
    const data = result.data;
    if (Array.isArray(data.gigs)) { setGigs(data.gigs as Gig[]); writeCachedGigFeed(data.gigs as Gig[]); }
    if (Array.isArray(data.applications)) setApplications(data.applications as GigApplication[]);
    if (Array.isArray(data.assignments)) setAssignments(data.assignments as GigAssignment[]);
    if (Array.isArray(data.payoutBatches)) setPayoutBatches(data.payoutBatches as PayoutBatch[]);
    if (data.wallet) setWalletBalance(data.wallet);
    if (result.workerId) setWorkerId(result.workerId);
    setUsingSavedData(result.errors.length > 0);
    if (!result.errors.length) setLastSyncedAt(result.checkedAt);
    setError(result.errors.length ? "Some updates are unavailable. Your last saved information is still shown." : null);
    setLoading(false);
    setGigsLoading(false);
  }, []);

  useEffect(() => {
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    const redirect = () => window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    const cleared = () => {
      setApplications([]); setAssignments([]); setPayoutBatches([]); setWorkerProfile(null);
      setLoading(true); setProfileLoading(true);
      redirect();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === CREATOR_CACHE_OWNER && creatorCacheIdentity() && event.newValue !== creatorCacheIdentity()) {
        detachCreatorCacheIdentity();
      }
    };
    window.addEventListener(CREATOR_CACHE_CLEARED, cleared);
    window.addEventListener("storage", onStorage);

    (async () => {
      const cachedGigFeed = readCachedGigFeed();
      if (cachedGigFeed.length) { setGigs(cachedGigFeed); setGigsLoading(false); }
      // Supabase restores the local session immediately. The authenticated API verifies access before every read.
      const sessionResult = await supabase.auth.getSession().catch(() => null);
      if (!alive) return;
      const session = sessionResult?.data?.session;
      const cachedAuth = readCachedSession();
      const demo = isLocalDevHost() && (cachedAuth?.role === "Worker" || cachedAuth?.role === "Admin");
      const user = session?.user ?? (demo ? { id: cachedAuth?.workerId ?? "dev-dashboard-user", email: cachedAuth?.email, user_metadata: { name: cachedAuth?.name } } : null);
      if (!user || (!session?.access_token && !demo)) { clearCreatorDeviceCache(); redirect(); return; }
      const scope = user.id;
      bindCreatorCacheIdentity(scope);
      const cached = readCreatorCache<DashboardSnapshot<Gig, GigApplication, GigAssignment, PayoutBatch>>(scope, "dashboard");
      let snapshot: typeof cached = null;
      try { if (cached?.data.userId === scope) snapshot = { ...cached, data: dashboardSnapshot(cached.data) as DashboardSnapshot<Gig, GigApplication, GigAssignment, PayoutBatch> }; } catch { /* Corrupt display storage is replaced by the live response. */ }
      const nextWorkerId = snapshot?.data.workerId ?? (demo ? cachedAuth?.workerId ?? null : null);
      const authEmail = String(user.email ?? "").trim();
      const contactEmail = userMetadataContactEmail(user, nextWorkerId) || usableContactEmail(authEmail, nextWorkerId);
      const name = getDisplayName({ email: authEmail, user_metadata: { name: String(user.user_metadata?.name ?? ""), full_name: String((user.user_metadata as Record<string, unknown>)?.full_name ?? "") } });
      setProfileUserId(scope); setWorkerId(nextWorkerId); setProfileRole("Creator");
      setProfileName(name); setProfileEmail(contactEmail || authEmail); setDirectApplyAuthEmail(contactEmail);
      setProfileLoading(false);
      const savedProfile = readCreatorCache<DashboardWorkerProfile>(scope, "profile");
      if (savedProfile) {
        try {
          const profile = creatorProfileData(savedProfile.data) as DashboardWorkerProfile;
          setWorkerProfile(profile);
          if (profile.name) setProfileName(profile.name);
        } catch { /* Live profile data replaces an unreadable saved profile. */ }
      }
      const savedVideo = readCreatorCache<IntroVideoMeta | null>(scope, "intro-video");
      if (savedVideo) setIntroVideo(savedVideo.data);
      if (snapshot) {
        setGigs(snapshot.data.gigs); setApplications(snapshot.data.applications);
        setAssignments(snapshot.data.assignments); setPayoutBatches(snapshot.data.payoutBatches);
        setLastSyncedAt(snapshot.updatedAt); setUsingSavedData(true);
        setLoading(false); setGigsLoading(false);
      }
      const authChange = supabase.auth.onAuthStateChange((event, nextSession) => {
        if (event === "SIGNED_OUT" || (nextSession && nextSession.user.id !== scope)) queueMicrotask(() => {
          if (!alive) return;
          if (event === "SIGNED_OUT") clearCreatorDeviceCache();
          else {
            detachCreatorCacheIdentity(false);
            window.location.reload();
          }
        });
      });
      unsubscribe = () => authChange.data.subscription.unsubscribe();
      // Profile details can arrive independently; a slow profile read never holds jobs or earnings back.
      void fetchCollection<DashboardWorkerProfile>("/api/workers").then(workers => {
        if (!alive || !isCreatorCacheIdentity(scope)) return;
        const matched = findMatchingWorkerProfile(workers, { workerId: nextWorkerId, userId: scope, email: contactEmail || authEmail });
        if (!matched) return;
        setWorkerProfile(matched);
        writeCreatorCache(scope, "profile", creatorProfileData(matched));
        if (!isSyntheticDevWorkerProfile(matched)) {
          if (matched.name) setProfileName(matched.name.trim());
          if (matched.email) setProfileEmail(matched.email);
        }
        const resolved = String(matched.workerId ?? matched.id ?? "").trim();
        if (resolved) setWorkerId(resolved);
      }).catch(() => undefined);
      setLiveSyncing(true);
      try {
        const result = await fetchCreatorDashboard(scope);
        if (alive) applyDashboard(result);
      } catch (failure) {
        if (!alive || !isCreatorCacheIdentity(scope) || (failure instanceof Error && failure.name === "AbortError")) return;
        setUsingSavedData(Boolean(snapshot));
        setError(snapshot ? "Unable to refresh right now. Your saved dashboard is still available." : "Unable to load your dashboard. Please try refreshing.");
        setLoading(false); setGigsLoading(false);
      } finally { if (alive) setLiveSyncing(false); }
    })();
    return () => {
      alive = false;
      unsubscribe?.();
      window.removeEventListener(CREATOR_CACHE_CLEARED, cleared);
      window.removeEventListener("storage", onStorage);
    };
  }, [applyDashboard]);

  // Signed media is fetched only when its screen is opened and is never persisted on the device.
  useEffect(() => {
    if (currentSection !== "profile" || !profileUserId || profileLoading) return;
    const controller = new AbortController();
    void fetchPayload<{ introVideo: IntroVideoMeta | null }>("/api/me/presentation-video", { signal: controller.signal })
      .then(value => {
        if (!controller.signal.aborted && isCreatorCacheIdentity(profileUserId)) {
          setIntroVideo(value.introVideo ?? null);
          writeCreatorCache(profileUserId, "intro-video", creatorVideoData(value.introVideo ?? null));
        }
      }).catch(() => undefined);
    return () => controller.abort();
  }, [currentSection, profileUserId, profileLoading]);

  const refreshLiveData = useCallback(async (afterCurrent = false) => {
    if (!profileUserId || !isCreatorCacheIdentity(profileUserId) || !navigator.onLine) return;
    liveSyncCount.current++;
    setLiveSyncing(true);
    try { applyDashboard(await fetchCreatorDashboard(profileUserId, afterCurrent)); }
    catch (failure) {
      if (isCreatorCacheIdentity(profileUserId) && !(failure instanceof Error && failure.name === "AbortError")) {
        setUsingSavedData(true);
        setError("Unable to refresh right now. Your last saved information is still shown.");
      }
    } finally {
      liveSyncCount.current--;
      if (!liveSyncCount.current) setLiveSyncing(false);
    }
  }, [profileUserId, applyDashboard]);

  useEffect(() => {
    // Detail views re-read fields intentionally excluded from device storage, such as payout notes.
    if (profileUserId && (currentSection === "wallet" || (currentSection === "find" && selectedGigId))) void refreshLiveData(true);
  }, [currentSection, selectedGigId, profileUserId, refreshLiveData]);

  useEffect(() => {
    const onClaimUpdated = () => { void refreshLiveData(); };
    window.addEventListener("view-payout-claims-updated", onClaimUpdated);
    return () => window.removeEventListener("view-payout-claims-updated", onClaimUpdated);
  }, [refreshLiveData]);

  useEffect(() => {
    if (loading || typeof window === "undefined") return;

    let debounceTimer: number | null = null;
    const scheduleRefresh = () => {
      if (debounceTimer) return;
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        void refreshLiveData();
      }, 600);
    };

    // Realtime: tables confirmed in the API routes / payouts page.
    const channels = [
      supabase.channel("dashboard-gigs").on("postgres_changes", { event: "*", schema: "public", table: "gigs" }, scheduleRefresh),
    ];
    if (workerId) {
      channels.push(
        supabase
          .channel(`dashboard-assignments-${workerId}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "gig_assignments", filter: `worker_code=eq.${workerId}` }, scheduleRefresh)
      );
    }
    channels.forEach((channel) => channel.subscribe());
    // Payouts and the wallet balance are server-only tables: their changes arrive as a content-free signal on the
    // creator's private payouts topic (requests, approvals, rejections and returned money, credits, UPI and KYC).
    let disposed = false;
    let payoutChannel: ReturnType<typeof supabase.channel> | null = null;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (disposed || !session) return;
      await supabase.realtime.setAuth(session.access_token);
      if (disposed) return;
      payoutChannel = supabase
        .channel(`payouts:${session.user.id}`, { config: { private: true } })
        .on("broadcast", { event: "changed" }, scheduleRefresh)
        .subscribe((status) => { if (status === "SUBSCRIBED") scheduleRefresh(); });
    })().catch(() => undefined);

    // Fallback polling (also covers applications) and instant catch-up when the tab regains focus.
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshLiveData();
    }, 20000);
    const onVisible = () => {
      if (document.visibilityState === "visible") scheduleRefresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", scheduleRefresh);
    const onOffline = () => setUsingSavedData(true);
    window.addEventListener("offline", onOffline);

    return () => {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", scheduleRefresh);
      window.removeEventListener("offline", onOffline);
      channels.forEach((channel) => {
        void supabase.removeChannel(channel);
      });
      disposed = true;
      if (payoutChannel) void supabase.removeChannel(payoutChannel);
    };
  }, [loading, refreshLiveData, workerId]);

  const gigById = useMemo(() => {
    const map = new Map<string, Gig>();
    gigs.forEach((gig) => {
      map.set(String(gig.id), gig);
    });
    return map;
  }, [gigs]);

  const openGigs = useMemo(
    () =>
      gigs
        .filter((gig) => String(gig.status ?? "").trim().toLowerCase() !== "closed")
        .sort((left, right) => {
          const pinnedRank = (left.browsePinned ? -1000 : 0) - (right.browsePinned ? -1000 : 0);
          if (pinnedRank !== 0) return pinnedRank;
          const explicitRank = Number(left.browsePinRank ?? 9999) - Number(right.browsePinRank ?? 9999);
          if (explicitRank !== 0) return explicitRank;
          // The team's feed order, not newest first. Gigs without a position keep the API's order (a stable sort).
          return Number(left.feedPosition ?? Number.MAX_SAFE_INTEGER) - Number(right.feedPosition ?? Number.MAX_SAFE_INTEGER);
        }),
    [gigs]
  );

  const platformOptions = useMemo(() => {
    const values = new Set<string>();
    openGigs.forEach((gig) => {
      const platform = String(gig.platform ?? "").trim();
      if (platform) values.add(platform);
    });
    return ["All", ...Array.from(values)];
  }, [openGigs]);
  const activePlatformFilter = platformOptions.includes(platformFilter) ? platformFilter : "All";

  const locationOptions = useMemo(() => {
    const values = new Set<string>();
    openGigs.forEach((gig) => {
      const location = compactLocationLabel(gig.location);
      if (location && location !== "Remote") values.add(location);
    });
    return ["All regions", ...Array.from(values)];
  }, [openGigs]);
  const activeLocationFilter = locationOptions.includes(locationFilter) ? locationFilter : "All regions";

  const normalizedAssignments = useMemo(
    () =>
      assignments.map((assignment) => ({
        ...assignment,
        gigKey: String(assignment.gigId ?? assignment.gig_id ?? ""),
        statusLabel: formatStatusLabel(assignment.status),
        primaryDate:
          assignment.decidedAt ??
          assignment.decided_at ??
          assignment.submittedAt ??
          assignment.submitted_at ??
          assignment.createdAt ??
          assignment.created_at,
      })),
    [assignments]
  );

  const assignedJobEntries = useMemo(
    () =>
      normalizedAssignments
        .map((assignment) => ({
          assignment,
          gig: gigById.get(assignment.gigKey) ?? null,
        }))
        .sort((left, right) => safeTime(right.assignment.primaryDate) - safeTime(left.assignment.primaryDate)),
    [gigById, normalizedAssignments]
  );
  // Weekly application limit: counted from the creator's own applications so it updates live; a blocked attempt's
  // server answer (which can see applications this list can't) wins until its next slot opens.
  const [serverQuota, setServerQuota] = useState<ApplicationQuota | null>(null);
  const weeklyQuota = useMemo(() => strictestQuota(applicationQuota(applications, minuteNow), serverQuota, minuteNow), [applications, serverQuota, minuteNow]);
  /** Why applying to this gig is blocked right now, or null when it isn't. */
  const weeklyLimitBlock = useCallback((gigId: string) => (quotaBlocksGig(weeklyQuota, gigId) ? quotaLimitMessage(weeklyQuota, { now: Date.now() }) : null), [weeklyQuota]);
  const rememberServerQuota = useCallback((failure: { code?: string; quota?: ApplicationQuota | null }) => {
    if (failure?.code === "weekly_application_limit" && failure.quota) setServerQuota(failure.quota);
  }, []);
  const applicationByGigId = useMemo(() => {
    const map = new Map<string, GigApplication>();
    applications.forEach((application) => {
      const gigId = String(application.gigId ?? "").trim();
      if (gigId) map.set(gigId, application);
    });
    return map;
  }, [applications]);
  const assignmentByGigId = useMemo(() => {
    const map = new Map<string, (typeof normalizedAssignments)[number]>();
    normalizedAssignments.forEach((assignment) => {
      const gigId = String(assignment.gigKey ?? "").trim();
      if (gigId) map.set(gigId, assignment);
    });
    return map;
  }, [normalizedAssignments]);

  const payoutSummary = useMemo(() => summarizePayoutBatches(payoutBatches), [payoutBatches]);
  // Approved Content Posting jobs are tracked from their linked account: its state, the reels submitted and their pay.
  const jobPostingByGigId = useMemo(() => {
    const map = new Map<string, JobPosting>();
    const ready = socialAccounts.load.state === "ready";
    const issues = socialAccounts.load.state === "ready" ? socialAccounts.load.accountIssues ?? [] : [];
    applications.forEach((application) => {
      const gigId = String(application.gigId ?? "").trim();
      const gig = gigById.get(gigId);
      if (!gig || !isContentPostingGig(gig) || String(application.status).trim().toLowerCase() !== "accepted") return;
      const matches = (account: (typeof linkedAccounts)[number]) => String(account.gigId) === gigId || String(account.applicationId) === String(application.id);
      const account = linkedAccounts.find((item) => item.status !== "unlinked" && matches(item)) ?? null;
      const issue = account ? null : issues.find(matches) ?? null;
      const setup = application.proposal?.accountSetup;
      const state: JobPosting["state"] = account
        ? "linked"
        : issue
          ? "fix"
          : !ready
            ? "checking"
            : setup?.status === "Verified"
              ? "linked"
              : setup?.status === "ChangesRequested"
                ? "changes"
                : setup
                  ? "verifying"
                  : "setup";
      map.set(gigId, { state, handle: account?.handle || issue?.handle || setup?.handle || undefined, ...postingProgress(account ?? issue, payoutBatches) });
    });
    return map;
  }, [applications, gigById, linkedAccounts, payoutBatches, socialAccounts.load]);

  const visibleWorkerProfile = useMemo(
    () => (isSyntheticDevWorkerProfile(workerProfile) ? null : workerProfile),
    [workerProfile]
  );

  const profileDisplayName = useMemo(() => {
    const candidate = String(visibleWorkerProfile?.name || profileName || "").trim();
    return candidate || "Creator";
  }, [profileName, visibleWorkerProfile?.name]);
  const dashboardFirstName = useMemo(() => {
    const first = profileDisplayName.split(/\s+/).filter(Boolean)[0];
    return first || profileDisplayName;
  }, [profileDisplayName]);

  const profilePrimaryEmail = useMemo(() => {
    const candidate = String(visibleWorkerProfile?.email || profileEmail || "").trim();
    return candidate || "No email on file";
  }, [profileEmail, visibleWorkerProfile?.email]);
  const profilePrimaryEmailIsGenerated = useMemo(
    () => isGeneratedProfileEmail(profilePrimaryEmail, workerId),
    [profilePrimaryEmail, workerId]
  );
  const profileContactEmail = useMemo(() => {
    if (profilePrimaryEmail === "No email on file" || profilePrimaryEmailIsGenerated) return "";
    return usableContactEmail(profilePrimaryEmail, workerId);
  }, [profilePrimaryEmail, profilePrimaryEmailIsGenerated, workerId]);
  const profileEmailDisplay = profileContactEmail || "Email not connected";

  const directApplyWorkerEmail = profileContactEmail;

  const directApplySubmissionEmail = useMemo(() => {
    return usableContactEmail(directApplyWorkerEmail || directApplyAuthEmail, workerId);
  }, [directApplyAuthEmail, directApplyWorkerEmail, workerId]);

  const directApplyContactValue = useMemo(() => {
    if (directApplySubmissionEmail) return directApplySubmissionEmail;
    if (directApplyContactLoading) return "Resolving contact...";
    return "Add a login email to submit";
  }, [directApplyContactLoading, directApplySubmissionEmail]);

  const directApplyContactStatus = useMemo(() => {
    if (directApplySubmissionEmail) return directApplyWorkerEmail ? "Profile email" : "Login email";
    if (directApplyContactLoading) return "Checking";
    return "Email required";
  }, [directApplyContactLoading, directApplySubmissionEmail, directApplyWorkerEmail]);

  const directApplyReviewStateLabel = "Queued after submit";
  const directApplyCanSubmit = directApplyAgreementChecked && !!directApplySubmissionEmail && !directApplyContactLoading && !proposalSaving;

  const submissionWorkerId = useMemo(() => {
    const fromWorkerProfile = String(workerProfile?.workerId ?? workerProfile?.id ?? "").trim();
    const fromSession = String(workerId ?? "").trim();
    const fromUser = String(profileUserId ?? "").trim();
    const fromEmail = profileContactEmail;
    return fromSession || fromWorkerProfile || fromUser || fromEmail || null;
  }, [profileContactEmail, profileUserId, workerId, workerProfile?.id, workerProfile?.workerId]);

  // Live account card: the server signals "changed" on this user's private account topic (migration
  // 202610110004) when their profile, worker record or account assignments change, from another tab, device or an
  // admin. We re-read just the profile and briefly highlight what changed. A minute-long profile refresh stays as backup.
  const [accountLive, setAccountLive] = useState<"connecting" | "live" | "offline">("connecting");
  const [accountSyncedAt, setAccountSyncedAt] = useState<number | null>(null);
  const [accountFlash, setAccountFlash] = useState<Set<string>>(() => new Set());
  const accountFlashTimer = useRef<number | null>(null);
  const workerProfileRef = useRef(workerProfile);
  const accountIdsRef = useRef({ workerId, email: profileContactEmail });
  useEffect(() => {
    workerProfileRef.current = workerProfile;
    accountIdsRef.current = { workerId, email: profileContactEmail };
  }, [workerProfile, workerId, profileContactEmail]);
  useEffect(() => {
    if (!profileUserId) return;
    let disposed = false;
    let timer: number | null = null;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const refreshProfile = async () => {
      timer = null;
      if (disposed || document.hidden) return;
      try {
        const { workerId: currentWorkerId, email } = accountIdsRef.current;
        const list = await fetchCollection<DashboardWorkerProfile>(currentWorkerId ? `/api/workers?workerId=${encodeURIComponent(currentWorkerId)}` : "/api/workers");
        if (disposed || !isCreatorCacheIdentity(profileUserId)) return;
        const next = findMatchingWorkerProfile(list, { workerId: currentWorkerId, userId: profileUserId, email });
        if (!next) return;
        const prev = workerProfileRef.current;
        const changed = new Set<string>();
        if (prev) {
          if ((prev.assignedAccountIds?.length ?? 0) !== (next.assignedAccountIds?.length ?? 0)) changed.add("assigned");
          if ((prev.name ?? "") !== (next.name ?? "")) changed.add("name");
          if ((prev.headline ?? "") !== (next.headline ?? "") || (prev.city ?? "") !== (next.city ?? "") || (prev.bio ?? "") !== (next.bio ?? "")) changed.add("about");
        }
        setWorkerProfile(next);
        writeCreatorCache(profileUserId, "profile", creatorProfileData(next));
        if (next.name && !isSyntheticDevWorkerProfile(next)) setProfileName(String(next.name).trim());
        setAccountSyncedAt(Date.now());
        if (changed.size) {
          setAccountFlash(changed);
          if (accountFlashTimer.current) window.clearTimeout(accountFlashTimer.current);
          accountFlashTimer.current = window.setTimeout(() => setAccountFlash(new Set()), 3500);
        }
      } catch {
        /* The periodic dashboard refresh will catch up. */
      }
    };
    const schedule = () => {
      if (timer === null && !disposed) timer = window.setTimeout(() => void refreshProfile(), 350);
    };
    const connect = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (disposed || !data.session) return;
        await supabase.realtime.setAuth(data.session.access_token);
        if (disposed) return;
        channel = supabase
          .channel(`account:${data.session.user.id}`, { config: { private: true } })
          .on("broadcast", { event: "changed" }, schedule)
          .subscribe((status) => {
            if (disposed) return;
            setAccountLive(status === "SUBSCRIBED" ? "live" : status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED" ? "offline" : "connecting");
            if (status === "SUBSCRIBED") schedule();
          });
      } catch {
        if (!disposed) setAccountLive("offline");
      }
    };
    void connect();
    const onOffline = () => setAccountLive("offline");
    const onOnline = () => schedule();
    const profileInterval = window.setInterval(() => { if (!document.hidden && navigator.onLine) schedule(); }, 60_000);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
      window.clearInterval(profileInterval);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [profileUserId]);


  const profileCity = useMemo(() => String(workerProfile?.city ?? "").trim(), [workerProfile?.city]);
  const profileBio = useMemo(() => String(workerProfile?.bio ?? "").trim(), [workerProfile?.bio]);
  const assignedAccounts = useMemo(() => workerProfile?.assignedAccounts ?? [], [workerProfile?.assignedAccounts]);
  const assignedAccountsCount = useMemo(
    () => workerProfile?.assignedAccountIds?.length ?? assignedAccounts.length,
    [assignedAccounts.length, workerProfile?.assignedAccountIds?.length]
  );
  const hasPresentationVideo = useMemo(
    () => !!(introVideo && (introVideo.previewUrl || introVideo.thumbnailUrl || introVideo.path || introVideo.name)),
    [introVideo]
  );
  const profileChecklist = useMemo(
    () => [
      { label: "Display name", complete: !!profileDisplayName.trim() },
      { label: "Primary email", complete: !!profileContactEmail },
      { label: "Creator headline", complete: !!String(workerProfile?.headline ?? "").trim() },
      { label: "Location", complete: !!profileCity },
      { label: "Bio", complete: !!profileBio },
      ...(PRESENTATION_VIDEO_ENABLED ? [{ label: "Intro video", complete: hasPresentationVideo }] : []),
    ],
    [hasPresentationVideo, profileBio, profileCity, profileContactEmail, profileDisplayName, workerProfile?.headline]
  );
  const profileCompletion = useMemo(() => {
    const completed = profileChecklist.filter((item) => item.complete).length;
    return Math.round((completed / profileChecklist.length) * 100);
  }, [profileChecklist]);
  const profileSyncLabel = useMemo(() => {
    if (profileLoading || loading) return strings.shell.syncingData;
    if (assignments.length > 0 || applications.length > 0) return "Pipeline live";
    if (workerProfile || profileContactEmail) return "Profile synced";
    return "Profile pending";
  }, [applications.length, assignments.length, loading, profileContactEmail, profileLoading, strings.shell.syncingData, workerProfile]);

  // After ProfileEditor saves: keep the session cache, header name, apply-flow email and profile in sync.
  const applySavedProfile = useCallback(
    (saved: { name: string; email: string; headline: string; city: string; bio: string; workerId?: string; userId?: string; active?: boolean }) => {
      const savedWorkerId = String(saved.workerId ?? workerId ?? "").trim();
      const savedUserId = String(saved.userId ?? profileUserId ?? "").trim();
      const savedEmail = usableContactEmail(saved.email, workerId) || saved.email;
      mergeCachedSessionIdentity({ name: saved.name, email: savedEmail, workerId: savedWorkerId || workerId });
      setProfileName(saved.name);
      setProfileEmail(savedEmail);
      setDirectApplyAuthEmail(savedEmail);
      if (savedWorkerId) setWorkerId(savedWorkerId);
      setWorkerProfile((current) =>
        current
          ? { ...current, name: saved.name, email: savedEmail, headline: saved.headline, city: saved.city, bio: saved.bio }
          : savedWorkerId
            ? { id: savedWorkerId, workerId: savedWorkerId, userId: savedUserId || undefined, name: saved.name, email: savedEmail, headline: saved.headline, city: saved.city, bio: saved.bio, active: saved.active ?? true }
            : current
      );
    },
    [profileUserId, workerId]
  );

  const searchAndRegionJobs = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    return openGigs.filter((gig) => {
      if (activeLocationFilter !== "All regions" && compactLocationLabel(gig.location) !== activeLocationFilter) return false;
      if (!query) return true;
      const haystack = [
        gig.title,
        gig.company,
        gig.platform,
        gig.location,
        ...(gig.requirements ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [activeLocationFilter, deferredSearch, openGigs]);

  const filteredJobs = useMemo(
    () => (activePlatformFilter === "All" ? searchAndRegionJobs : searchAndRegionJobs.filter((gig) => gig.platform === activePlatformFilter)),
    [activePlatformFilter, searchAndRegionJobs]
  );

  const platformCounts = useMemo(() => {
    const counts = new Map<string, number>([["All", searchAndRegionJobs.length]]);
    searchAndRegionJobs.forEach((gig) => {
      const platform = String(gig.platform ?? "").trim();
      if (platform) counts.set(platform, (counts.get(platform) ?? 0) + 1);
    });
    return counts;
  }, [searchAndRegionJobs]);

  const selectedGig = useMemo(
    () => openGigs.find((gig) => String(gig.id) === selectedGigId) ?? gigs.find((gig) => String(gig.id) === selectedGigId) ?? null,
    [gigs, openGigs, selectedGigId]
  );
  const selectedGigApplication = useMemo(
    () => applications.find((application) => String(application.gigId) === String(selectedGigId ?? "")) ?? null,
    [applications, selectedGigId]
  );
  const directApplyTargetGig = useMemo(() => {
    const targetId = String(directApplyGigId ?? "").trim();
    if (targetId) return gigById.get(targetId) ?? null;
    return selectedGig;
  }, [directApplyGigId, gigById, selectedGig]);
  const directApplyTargetApplication = useMemo(() => {
    const targetId = String(directApplyTargetGig?.id ?? "").trim();
    if (!targetId) return null;
    return applications.find((application) => String(application.gigId) === targetId) ?? null;
  }, [applications, directApplyTargetGig?.id]);
  const selectedGigReviewStatus = useMemo(() => getProposalReviewStatus(selectedGigApplication), [selectedGigApplication]);
  const updateWorkAssignment = useCallback((next: WorkAssignment) => {
    setAssignments(previous => {
      const updated = [next, ...previous.filter(row => String(row.id) !== next.id && String(row.gigId ?? row.gig_id) !== next.gigId)];
      const scope = creatorCacheIdentity();
      if (scope) patchCachedDashboard(scope, { assignments: updated });
      return updated;
    });
  }, []);

  const openGigDetail = useCallback((gig: Gig, intent: "details" | "apply" = "details") => {
    writeDashboardSectionToUrl("find", { gigId: String(gig.id), intent }, true);
    setSelectedGigId(String(gig.id));
    setSelectedGigIntent(intent);
    setDirectApplyGigId(null);
    setDirectApplyLaunchGigId(null);
    setProposalDeskOpen(intent === "apply");
    setProposalError(null);
    setProposalSuccess(null);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  const openGigApplication = useCallback((gig: Gig) => {
    if (getDashboardApplicationMode(gig) !== "apply") {
      openGigDetail(gig, "apply");
      return;
    }

    const gigId = String(gig.id);
    setSelectedGigId(null);
    setSelectedGigIntent("details");
    setProposalDeskOpen(false);
    setProposalError(null);
    setProposalSuccess(null);
    setDirectApplyError(null);
    setDirectApplyGigId(gigId);
    setDirectApplyLaunchGigId(gigId);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [openGigDetail]);

  // Background refreshes (every 10s) return fresh objects for the same application. Key the form reset on
  // what actually changed (another gig/application, a new submission or review) so in-progress edits survive.
  const selectedProposalSignature = [
    selectedGigApplication?.id ?? "",
    selectedGigApplication?.status ?? "",
    selectedGigApplication?.proposal?.submittedAt ?? "",
    selectedGigApplication?.proposal?.reviewStatus ?? "",
    selectedGigApplication?.proposal?.reviewedAt ?? "",
  ].join("|");
  const selectedGigApplicationRef = useRef(selectedGigApplication);
  selectedGigApplicationRef.current = selectedGigApplication;

  useEffect(() => {
    const application = selectedGigApplicationRef.current;
    setProposalPitch(String(application?.proposal?.pitch ?? ""));
    setProposalTimeline(String(application?.proposal?.timeline ?? ""));
    setProposalBudget(String(application?.proposal?.budget ?? ""));
    setProposalPortfolio(String(application?.proposal?.portfolio ?? ""));
    setProposalError(null);
    setDirectApplyModalOpen(false);
    setDirectApplyAgreementChecked(false);
    setDirectApplyError(null);
    setDirectApplyAuthEmail("");
    setDirectApplyContactLoading(false);
    setProposalDeskOpen(selectedGigIntent === "apply" || selectedGigReviewStatus === "Rejected");
  }, [selectedProposalSignature, selectedGigIntent, selectedGigReviewStatus, selectedGigId]);

  const scrollToProposalDesk = useCallback((openDesk = true) => {
    if (openDesk) setProposalDeskOpen(true);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        proposalDeskRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, []);

  const closeDirectApplyModal = useCallback(() => {
    if (proposalSavingRef.current) return;
    setDirectApplyModalOpen(false);
    setDirectApplyGigId(null);
    setDirectApplyLaunchGigId(null);
  }, []);

  useEffect(() => {
    if (!directApplyModalOpen || typeof document === "undefined") return;

    const previousOverflow = document.body.style.overflow;
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => {
      directApplyDialogRef.current?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDirectApplyModal();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previousActiveElement?.focus();
    };
  }, [closeDirectApplyModal, directApplyModalOpen]);

  useEffect(() => {
    if (!directApplySuccess || typeof document === "undefined") return;
    const previousOverflow = document.body.style.overflow;
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => directApplySuccessPrimaryRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDirectApplySuccess(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previousActiveElement?.focus();
    };
  }, [directApplySuccess]);

  const openDashboardDirectApplyModal = useCallback(async () => {
    if (!directApplyTargetGig?.id) return;
    if (directApplyTargetApplication) {
      setProposalError("This application is already in the hiring queue. Track recruiter updates from the status panel.");
      return;
    }
    const limitBlock = weeklyLimitBlock(String(directApplyTargetGig.id));
    if (limitBlock) {
      setDirectApplyGigId(null);
      setDirectApplyLaunchGigId(null);
      setProposalError(limitBlock);
      return;
    }

    const sessionError = !submissionWorkerId ? "Your dashboard session has expired. Refresh the page and try again." : null;
    setDirectApplyGigId(String(directApplyTargetGig.id));
    setProposalError(null);
    setProposalSuccess(null);
    setDirectApplyError(sessionError);
    setDirectApplyAgreementChecked(false);
    setDirectApplyAuthEmail("");
    setDirectApplyContactLoading(!directApplyWorkerEmail);
    setDirectApplyModalOpen(true);

    const authResult = await supabase.auth.getSession().catch(() => null);
    const authUser = authResult?.data?.session?.user ?? null;
    const authEmail = String(authUser?.email ?? "").trim();
    const authContactEmail = userMetadataContactEmail(authUser, workerId) || usableContactEmail(authEmail, workerId);
    setDirectApplyAuthEmail(authContactEmail);
    setDirectApplyContactLoading(false);
    if (!sessionError && !directApplyWorkerEmail && !authContactEmail) {
      setDirectApplyError("Add an email to your profile or login account before submitting this application.");
    }
  }, [directApplyTargetApplication, directApplyTargetGig?.id, directApplyWorkerEmail, submissionWorkerId, weeklyLimitBlock, workerId]);

  useLayoutEffect(() => {
    if (!directApplyLaunchGigId) return;
    if (loading || profileLoading || gigsLoading) return;
    if (!directApplyTargetGig || String(directApplyTargetGig.id) !== String(directApplyLaunchGigId)) return;

    setDirectApplyLaunchGigId(null);
    if (applications.some(application => String(application.gigId) === String(directApplyTargetGig.id))) {
      writeDashboardSectionToUrl("find", { gigId: String(directApplyTargetGig.id) });
      setSelectedGigId(String(directApplyTargetGig.id));
      setSelectedGigIntent("details");
      setDirectApplyGigId(null);
      setProposalDeskOpen(false);
      return;
    }
    if (getDashboardApplicationMode(directApplyTargetGig) !== "apply") {
      setDirectApplyGigId(null);
      setSelectedGigId(String(directApplyTargetGig.id));
      setSelectedGigIntent("apply");
      setProposalDeskOpen(true);
      return;
    }

    setSelectedGigId(null);
    setSelectedGigIntent("details");
    setProposalDeskOpen(false);
    void openDashboardDirectApplyModal();
  }, [
    applications,
    directApplyLaunchGigId,
    directApplyTargetGig,
    gigsLoading,
    loading,
    openDashboardDirectApplyModal,
    profileLoading,
  ]);

  const submitDashboardDirectApplication = useCallback(async () => {
    if (!directApplyTargetGig?.id) return;
    if (!submissionWorkerId) {
      setDirectApplyError("Your dashboard session has expired. Refresh the page and try again.");
      return;
    }
    if (directApplyTargetApplication) {
      setDirectApplyError("This application is already in the hiring queue.");
      return;
    }
    if (!directApplyAgreementChecked) {
      setDirectApplyError("Confirm the application terms before submitting.");
      return;
    }
    const limitBlock = weeklyLimitBlock(String(directApplyTargetGig.id));
    if (limitBlock) {
      setDirectApplyError(limitBlock);
      return;
    }
    if (!directApplySubmissionEmail) {
      setDirectApplyError("Add an email to your profile or login account before submitting this application.");
      return;
    }

    setProposalSaving(true);
    setDirectApplyError(null);
    setProposalError(null);
    setProposalSuccess(null);

    try {
      const authResult = await supabase.auth.getSession().catch(() => null);
      const authUser = authResult?.data?.session?.user ?? null;
      const submittedAt = new Date().toISOString();
      const resolvedWorkerEmail = directApplySubmissionEmail || null;
      const submittedGigId = String(directApplyTargetGig.id);
      const response = await fetch("/api/gig-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gigId: submittedGigId,
          workerId: submissionWorkerId,
          workerName: profileDisplayName || profileName || submissionWorkerId,
          workerEmail: resolvedWorkerEmail,
          workerUserId: profileUserId || authUser?.id || null,
          status: "Pending",
          proposal: {
            submittedAt,
            reviewStatus: "Pending",
            applicationMode: "direct_apply",
            source: "dashboard_direct_apply_modal",
            consentAcceptedAt: submittedAt,
            consentText: DIRECT_APPLY_CONSENT_TEXT,
            profileSnapshotName: profileDisplayName || profileName || "",
            profileSnapshotEmail: resolvedWorkerEmail || undefined,
          },
        }),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        rememberServerQuota(failure);
        throw new Error(failure?.code === "weekly_application_limit" && failure.quota ? quotaLimitMessage(failure.quota) : failure?.error || "Application could not be saved.");
      }

      const payload = (await response.json()) as GigApplication & { mailStatus?: { sent: boolean; reason?: string } | null };
      setApplications((previous) => {
        const next = [...previous];
        const index = next.findIndex(
          (item) => String(item.id) === String(payload.id) || (String(item.gigId) === String(payload.gigId) && String(item.workerId) === String(payload.workerId))
        );
        if (index >= 0) {
          next[index] = payload;
        } else {
          next.unshift(payload);
        }
        writeCachedGigApplications(next);
        return next;
      });
      setDirectApplyModalOpen(false);
      setDirectApplyGigId(null);
      setDirectApplyAgreementChecked(false);
      const detailPageIsBackdrop = !!selectedGig && String(selectedGig.id) === submittedGigId;
      if (detailPageIsBackdrop) {
        setProposalDeskOpen(true);
        setSelectedGigIntent("apply");
      }
      const instantApproval = isEmailCreatorGig(directApplyTargetGig);
      if (instantApproval) {
        // Approved on submit: open the gig page and start the work (emails + inbox) right away.
        setSelectedGigId(submittedGigId);
        setSelectedGigIntent("details");
        requestGigWorkStart(submittedGigId);
      }
      setDirectApplySuccess({
        instant: instantApproval,
        setupPlatform: !instantApproval && isContentPostingGig(directApplyTargetGig) ? directApplyTargetGig.platform || "Instagram" : undefined,
        gigId: submittedGigId,
        title: directApplyTargetGig.title,
        company: directApplyTargetGig.company,
        payout: directApplyTargetGig.payout,
        payoutType: directApplyTargetGig.payoutType,
        email: resolvedWorkerEmail,
        emailSent: payload.mailStatus?.sent !== false && !!resolvedWorkerEmail,
        submittedAt,
      });
      setProposalSuccess(
        instantApproval
          ? "Approved instantly. Your work emails and verification inbox are opening below."
          : payload.mailStatus?.sent === false
          ? "Application submitted. Dashboard tracking is active; email confirmation could not be sent for this profile."
          : "Application submitted. Recruiter screening updates will appear inside this dashboard."
      );
    } catch (error) {
      setDirectApplyError(error instanceof Error ? error.message : "Unable to submit application right now.");
    } finally {
      setProposalSaving(false);
    }
  }, [
    directApplyAgreementChecked,
    directApplySubmissionEmail,
    directApplyTargetApplication,
    directApplyTargetGig,
    profileDisplayName,
    profileName,
    profileUserId,
    rememberServerQuota,
    selectedGig,
    submissionWorkerId,
    weeklyLimitBlock,
  ]);

  const submitDashboardProposal = useCallback(async () => {
    if (!selectedGig?.id) return;
    if (!submissionWorkerId) {
      setProposalError("Your dashboard session has expired. Refresh the page and try again.");
      return;
    }

    const pitch = proposalPitch.trim();
    const timeline = proposalTimeline.trim();
    const budget = proposalBudget.trim();
    const portfolio = proposalPortfolio.trim();
    const requiresBudget = isProjectGig(selectedGig) || isContentPostingGig(selectedGig) || isCustomGig(selectedGig);

    const limitBlock = weeklyLimitBlock(String(selectedGig.id));
    if (limitBlock) {
      setProposalError(limitBlock);
      return;
    }

    if (!pitch || !timeline || (requiresBudget && !budget)) {
      setProposalError(requiresBudget ? "Add a proposal note, delivery timeline, and quoted rate before submitting." : "Add a proposal note and delivery timeline before submitting.");
      return;
    }

    setProposalSaving(true);
    setProposalError(null);
    setProposalSuccess(null);

    try {
      const authResult = await supabase.auth.getSession().catch(() => null);
      const authUser = authResult?.data?.session?.user ?? null;
      const authContactEmail = userMetadataContactEmail(authUser, workerId) || usableContactEmail(authUser?.email, workerId);
      const submittedAt = new Date().toISOString();
      const response = await fetch("/api/gig-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedGigApplication?.id,
          gigId: selectedGig.id,
          workerId: submissionWorkerId,
          workerName: profileDisplayName || profileName || submissionWorkerId,
          workerEmail: profileContactEmail || authContactEmail || null,
          workerUserId: profileUserId || authUser?.id || null,
          status: "Pending",
          proposal: {
            pitch,
            approach: pitch,
            timeline,
            budget,
            portfolio,
            submittedAt,
            reviewStatus: "Pending",
          },
        }),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        rememberServerQuota(failure);
        throw new Error(failure?.code === "weekly_application_limit" && failure.quota ? quotaLimitMessage(failure.quota) : failure?.error || "Unable to submit proposal right now.");
      }

      const payload = (await response.json()) as GigApplication;
      setApplications((previous) => {
        const next = [...previous];
        const index = next.findIndex(
          (item) => String(item.id) === String(payload.id) || (String(item.gigId) === String(payload.gigId) && String(item.workerId) === String(payload.workerId))
        );
        if (index >= 0) {
          next[index] = payload;
        } else {
          next.unshift(payload);
        }
        writeCachedGigApplications(next);
        return next;
      });
      setProposalDeskOpen(true);
      setSelectedGigIntent("apply");
      setProposalReceipt({ gigId: String(selectedGig.id), revision: selectedGigReviewStatus === "Rejected" });
      if (typeof window !== "undefined") {
        window.requestAnimationFrame(() => proposalDeskRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
      }
    } catch (error) {
      setProposalError(error instanceof Error ? error.message : "Unable to submit proposal right now.");
    } finally {
      setProposalSaving(false);
    }
  }, [
    profileContactEmail,
    profileDisplayName,
    profileName,
    profileUserId,
    proposalBudget,
    proposalPitch,
    proposalPortfolio,
    proposalTimeline,
    selectedGig,
    selectedGigApplication?.id,
    selectedGigReviewStatus,
    submissionWorkerId,
    weeklyLimitBlock,
    rememberServerQuota,
    workerId,
  ]);

  const messageThreads = useMemo<DashboardMessage[]>(() => {
    const threads: DashboardMessage[] = [];

    applications.forEach((application) => {
      const gig = gigById.get(String(application.gigId));
      const status = formatStatusLabel(application.status);
      const applicationUpdate =
        status === "Pending" ? "is awaiting review"
          : status === "Accepted" ? "has been accepted"
            : status === "Rejected" ? "was not selected"
              : `is ${status.toLowerCase()}`;
      const isUnread = ["Pending", "Accepted"].includes(status);
      threads.push({
        id: `application-${application.id}`,
        tone: status === "Accepted" ? "green" : status === "Rejected" ? "slate" : "amber",
        title: gig ? `${gig.title} application` : "Application update",
        preview: `Your application ${applicationUpdate}.`,
        meta: gig?.company ?? "Reelencer",
        detailTitle: gig ? `${gig.title}: application update` : "Your application update",
        detailBody: gig
          ? `Your application for ${gig.title} at ${gig.company} ${applicationUpdate}. View your application for details and next steps.`
          : `Your application ${applicationUpdate}. View your application for details and next steps.`,
        timestamp: application.decidedAt ?? application.appliedAt,
        unread: isUnread,
        status,
        actionLabel: "View application",
        section: "jobs",
      });
    });

    normalizedAssignments.forEach((assignment) => {
      const gig = gigById.get(assignment.gigKey);
      const status = assignment.statusLabel;
      threads.push({
        id: `assignment-${assignment.id ?? assignment.gigKey}`,
        tone: status === "Submitted" || status === "Accepted" ? "blue" : status === "Rejected" ? "slate" : "amber",
        title: gig ? `${gig.title} assignment` : "Assignment update",
        preview: `Assignment status: ${status.toLowerCase()}.`,
        meta: gig?.company ?? "Reelencer",
        detailTitle: gig ? `${gig.title}: assignment update` : "Your assignment update",
        detailBody: gig
          ? `Your assignment for ${gig.title} has a status of ${status.toLowerCase()}. Open your assignment to review the details and next steps.`
          : `Your assignment has a status of ${status.toLowerCase()}. Open your assignment to review the details and next steps.`,
        timestamp: assignment.primaryDate,
        unread: status !== "Rejected",
        status,
        actionLabel: "View assignment",
        section: "jobs",
      });
    });

    payoutBatches.forEach((batch) => {
      const total = batchTotal(batch);
      threads.push({
        id: `payout-${batch.id}`,
        tone: String(batch.status).toLowerCase() === "paid" ? "green" : "blue",
        title: `${batch.cycleLabel} payout`,
        preview: `${formatINR(total)} · ${formatStatusLabel(batch.status)} · ${batch.method}`,
        meta: "Reelencer",
        detailTitle: `${batch.cycleLabel} payout: ${formatStatusLabel(batch.status).toLowerCase()}`,
        detailBody: `Your payout of ${formatINR(total)} covers ${formatDetailedDate(batch.periodStart)} to ${formatDetailedDate(batch.periodEnd)}. Its status is ${formatStatusLabel(batch.status).toLowerCase()}. View your wallet for the payout details.`,
        timestamp: batch.paidAt ?? batch.processedAt ?? batch.createdAt,
        unread: String(batch.status).toLowerCase() !== "paid",
        status: formatStatusLabel(batch.status),
        actionLabel: "View wallet",
        section: "wallet",
        href: "/payouts",
      });
    });

    if (threads.length === 0) {
      threads.push({
        id: "starter-thread",
        tone: "blue",
        title: "Welcome to your inbox",
        preview: "Your application, assignment, and payout updates start here.",
        meta: "Reelencer",
        detailTitle: "Welcome to your inbox",
        detailBody:
          "Find gigs that fit your skills and apply when you're ready. Updates on your applications, assignments, and payouts will appear here, so you can keep track of your next steps.",
        timestamp: undefined,
        unread: false,
        actionLabel: "Find gigs",
        section: "find",
        href: undefined,
      });
    }

    const readKeys = new Set(readThreadKeys);
    return threads
      .map((thread) => ({ ...thread, important: !!thread.unread, unread: !!thread.unread && !readKeys.has(inboxThreadKey(thread)) }))
      .sort((left, right) => safeTime(right.timestamp) - safeTime(left.timestamp));
  }, [applications, gigById, normalizedAssignments, payoutBatches, readThreadKeys]);

  const activeSelectedThreadId = messageThreads.some((thread) => thread.id === selectedThreadId)
    ? selectedThreadId
    : messageThreads[0]?.id ?? null;

  const unreadCount = useMemo(() => countUnreadThreads(messageThreads), [messageThreads]);

  useEffect(() => {
    const readList = (key: string) => {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]");
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
      } catch {
        return [];
      }
    };
    setReadThreadKeys(readList(INBOX_READ_STORAGE_KEY));
    setStarredThreadIds(readList(INBOX_STARRED_STORAGE_KEY));
  }, []);

  const starredThreadSet = useMemo(() => new Set(starredThreadIds), [starredThreadIds]);

  const toggleThreadStar = useCallback((thread: DashboardMessage) => {
    setStarredThreadIds((prev) => {
      const next = prev.includes(thread.id) ? prev.filter((id) => id !== thread.id) : [...prev, thread.id].slice(-200);
      try {
        window.localStorage.setItem(INBOX_STARRED_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore localStorage persistence failures
      }
      return next;
    });
  }, []);

  const updateThreadReadState = useCallback((threads: DashboardMessage[], read: boolean) => {
    setReadThreadKeys((prev) => {
      const next = new Set(prev);
      threads.forEach((thread) => (read ? next.add(inboxThreadKey(thread)) : next.delete(inboxThreadKey(thread))));
      const list = Array.from(next).slice(-300);
      try {
        window.localStorage.setItem(INBOX_READ_STORAGE_KEY, JSON.stringify(list));
      } catch {
        // ignore localStorage persistence failures
      }
      return list;
    });
  }, []);

  const inboxFilterCounts = useMemo(() => {
    const counts: Record<InboxFilter, number> = { all: messageThreads.length, unread: 0, starred: 0, applications: 0, assignments: 0, payouts: 0 };
    messageThreads.forEach((thread) => {
      if (thread.unread) counts.unread += 1;
      if (starredThreadSet.has(thread.id)) counts.starred += 1;
      const category = inboxThreadCategory(thread);
      if (category !== "all") counts[category] += 1;
    });
    return counts;
  }, [messageThreads, starredThreadSet]);

  const filteredInboxThreads = useMemo(() => {
    const query = inboxQuery.trim().toLowerCase();
    return messageThreads.filter((thread) => {
      if (inboxFilter === "unread" && !thread.unread) return false;
      if (inboxFilter === "starred" && !starredThreadSet.has(thread.id)) return false;
      if (["applications", "assignments", "payouts"].includes(inboxFilter) && inboxThreadCategory(thread) !== inboxFilter) return false;
      if (!query) return true;
      return [thread.title, thread.meta, thread.preview, thread.detailTitle].some((field) => field.toLowerCase().includes(query));
    });
  }, [inboxFilter, inboxQuery, messageThreads, starredThreadSet]);

  const inboxSelectedThread =
    filteredInboxThreads.find((thread) => thread.id === activeSelectedThreadId) ?? filteredInboxThreads[0] ?? null;
  const inboxSelectedIndex = inboxSelectedThread ? filteredInboxThreads.indexOf(inboxSelectedThread) : -1;

  const openInboxThread = useCallback(
    (thread: DashboardMessage) => {
      setSelectedThreadId(thread.id);
      setInboxReaderOpen(true);
      setInboxDetailsOpen(false);
      if (thread.unread) updateThreadReadState([thread], true);
    },
    [updateThreadReadState]
  );

  useEffect(() => {
    if (!inboxDetailsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (inboxDetailsRef.current && !inboxDetailsRef.current.contains(event.target as Node)) setInboxDetailsOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [inboxDetailsOpen]);

  const copyInboxReference = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setInboxReferenceCopied(true);
      window.setTimeout(() => setInboxReferenceCopied(false), 1500);
    } catch {
      // clipboard unavailable (insecure context or denied permission)
    }
  }, []);

  useEffect(() => {
    if (currentSection !== "messages") return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) {
        if (event.key === "Escape" && target === inboxSearchRef.current) inboxSearchRef.current?.blur();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "/") {
        event.preventDefault();
        inboxSearchRef.current?.focus();
      } else if (event.key === "j" || event.key === "k") {
        const nextIndex = inboxSelectedIndex + (event.key === "j" ? 1 : -1);
        const next = filteredInboxThreads[nextIndex];
        if (next) {
          event.preventDefault();
          openInboxThread(next);
          document.getElementById(`inbox-row-${next.id}`)?.scrollIntoView({ block: "nearest" });
        }
      } else if (event.key === "s" && inboxSelectedThread) {
        event.preventDefault();
        toggleThreadStar(inboxSelectedThread);
      } else if (event.key === "Escape" && inboxDetailsOpen) {
        setInboxDetailsOpen(false);
      } else if (event.key === "Escape" || event.key === "u") {
        setInboxReaderOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentSection, filteredInboxThreads, inboxDetailsOpen, inboxSelectedIndex, inboxSelectedThread, openInboxThread, toggleThreadStar]);


  const copy = strings.sectionCopy[currentSection];

  const navigateFromView = (section: DashboardSection, options?: { gigId?: string | null; intent?: "details" | "apply" }) => {
    writeDashboardSectionToUrl(section, options);
    openDashboardDestination(section, options);
    if (typeof window !== "undefined") window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  };
  const openAccountSetupFromSuccess = (gigId: string) => {
    setDirectApplySuccess(null);
    navigateFromView("find", { gigId, intent: "details" });
    // navigateFromView scrolls to the top on the next frame; land on the setup panel after that.
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => revealAccountSetup()));
  };

  const renderSection = () => {
    if (currentSection === "profile") {
      const completedChecklistItems = profileChecklist.filter((item) => item.complete).length;

      return (
        <section className="section-swipe-settle">
          <div className="mx-auto w-full max-w-[1200px] space-y-4 sm:space-y-5">
            <PageHeader
              title="Profile"
              description="How brands and recruiters see you, and the details tied to your account."
              actions={
                <span className="hidden sm:block">
                  <UiButton variant="critical" onClick={logout}>
                    Sign out
                  </UiButton>
                </span>
              }
            />

            <div className="grid grid-cols-1 items-start gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="min-w-0 space-y-4 sm:space-y-5">
                {/* Live preview + one editor for identity and about-you (remounts if saved values change elsewhere) */}
                <ProfileEditor
                  key={`${profileUserId ?? workerId ?? "me"}:${profileDisplayName}|${profileContactEmail}|${workerProfile?.headline ?? ""}|${workerProfile?.city ?? ""}|${workerProfile?.bio ?? ""}`}
                  initial={{
                    name: profileDisplayName,
                    email: profileContactEmail,
                    headline: String(workerProfile?.headline ?? ""),
                    city: String(workerProfile?.city ?? ""),
                    bio: String(workerProfile?.bio ?? ""),
                  }}
                  roleLabel={displayProfileRole}
                  workerId={workerId}
                  userId={profileUserId}
                  emailNeedsAttention={!profileContactEmail || profilePrimaryEmailIsGenerated}
                  isGeneratedEmail={(email) => isGeneratedProfileEmail(email, workerId)}
                  onSaved={applySavedProfile}
                />

                {/* Presentation video */}
                {PRESENTATION_VIDEO_ENABLED ? (
                <UiCard aria-labelledby="profile-video-title">
                  <UiCardHeader
                    id="profile-video-title"
                    title="Presentation video"
                    description={hasPresentationVideo && introVideo?.uploadedAt ? `Updated ${formatRelative(introVideo.uploadedAt)}` : "A short intro helps brands pick you faster."}
                    action={
                      <Link href="/workspace" className={buttonClassName("secondary", "sm")}>
                        {hasPresentationVideo ? "Manage" : "Upload"}
                      </Link>
                    }
                  />
                  <div className="p-4 sm:p-5">
                    <div className="overflow-hidden rounded-lg border border-[#e3e5e1] bg-[#f7f8f6]">
                      {profileLoading ? (
                        <div className="aspect-video animate-pulse bg-[#eceeea]" />
                      ) : hasPresentationVideo ? (
                        <div className="aspect-video bg-[#111511]">
                          {introVideo?.previewUrl ? (
                            <video controls playsInline preload="metadata" poster={introVideo.thumbnailUrl} className="h-full w-full object-contain">
                              <source src={introVideo.previewUrl} type={introVideo.mimeType || "video/mp4"} />
                            </video>
                          ) : introVideo?.thumbnailUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={introVideo.thumbnailUrl} alt={`${introVideo.name} preview`} className="h-full w-full object-contain" />
                          ) : (
                            <div className="flex h-full flex-col items-center justify-center gap-2 text-white/80">
                              <PlayIcon className="h-6 w-6" />
                              <div className="text-[13px] font-medium">Video uploaded</div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex aspect-video flex-col items-center justify-center px-6 text-center">
                          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-[#5b665f] ring-1 ring-[#e3e5e1]">
                            <UiIcon.Video className="h-5 w-5" />
                          </span>
                          <div className="mt-2.5 text-[13.5px] font-semibold text-[#1a201c]">No intro video yet</div>
                          <p className="mt-1 max-w-[40ch] text-[12.5px] text-[#616a64]">Upload a 30–60 second introduction from your workspace.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </UiCard>
                ) : null}
              </div>

              <div className="grid min-w-0 grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 lg:grid-cols-1">
                {/* Readiness: every item jumps to the place it's completed */}
                <UiCard aria-labelledby="profile-readiness-title">
                  <UiCardHeader
                    id="profile-readiness-title"
                    title="Profile readiness"
                    description={completedChecklistItems === profileChecklist.length ? "Complete. Brands see your full profile." : `${completedChecklistItems} of ${profileChecklist.length} complete · tap an item to finish it`}
                  />
                  <div className="mx-4 mt-3 grid gap-1 sm:mx-5" style={{ gridTemplateColumns: `repeat(${profileChecklist.length}, minmax(0, 1fr))` }} aria-hidden="true">
                    {profileChecklist.map((item, index) => (
                      <span key={item.label} className={cx("h-1.5 rounded-full transition-colors duration-500", index < completedChecklistItems ? "bg-[#2e7d4f]" : "bg-[#e3efe2]")} />
                    ))}
                  </div>
                  <ul className="mt-2 pb-2">
                    {profileChecklist.map((item) => {
                      const target: Record<string, string> = {
                        "Display name": PROFILE_FIELD_IDS.name,
                        "Primary email": PROFILE_FIELD_IDS.email,
                        "Creator headline": PROFILE_FIELD_IDS.headline,
                        Location: PROFILE_FIELD_IDS.city,
                        Bio: PROFILE_FIELD_IDS.bio,
                      };
                      const isNext = !item.complete && profileChecklist.find((c) => !c.complete)?.label === item.label;
                      const content = (
                        <>
                          <span
                            className={cx(
                              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                              item.complete ? "bg-[#1f2b24] text-white" : isNext ? "border-[1.5px] border-[#2e7d4f] bg-[#eef6ec]" : "border-[1.5px] border-dashed border-[#a9b0aa]"
                            )}
                            aria-hidden="true"
                          >
                            {item.complete ? <UiIcon.Check className="h-3 w-3" /> : null}
                          </span>
                          <span className={cx("flex-1 text-[13px]", item.complete ? "text-[#7a827c]" : "font-medium text-[#1a201c]")}>{item.label}</span>
                          {isNext ? <span className="rounded-full bg-[#e3f1df] px-1.5 py-px text-[10.5px] font-semibold text-[#1f5131]">Next</span> : null}
                          {!item.complete ? <UiIcon.ChevronRight className="h-4 w-4 shrink-0 text-[#a3aaa4] transition group-hover:translate-x-0.5 group-hover:text-[#4b544e]" /> : null}
                          <span className="sr-only">{item.complete ? "Complete" : "Missing"}</span>
                        </>
                      );
                      const rowClass = "group flex w-full items-center gap-3 px-4 py-2 text-left sm:px-5";
                      return (
                        <li key={item.label}>
                          {item.complete ? (
                            <div className={rowClass}>{content}</div>
                          ) : item.label === "Intro video" ? (
                            <Link href="/workspace" className={cx(rowClass, "transition hover:bg-[#fafbf9]")}>
                              {content}
                            </Link>
                          ) : (
                            <button
                              type="button"
                              className={cx(rowClass, "transition hover:bg-[#fafbf9] focus-visible:bg-[#fafbf9] focus-visible:outline-none")}
                              onClick={() => {
                                const el = document.getElementById(target[item.label] ?? "");
                                if (!el) return;
                                el.scrollIntoView({ behavior: "smooth", block: "center" });
                                window.setTimeout(() => (el as HTMLInputElement).focus({ preventScroll: true }), 350);
                              }}
                            >
                              {content}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </UiCard>

                {/* Account info: live (account topic + online state) */}
                <UiCard aria-labelledby="profile-account-title">
                  <UiCardHeader
                    id="profile-account-title"
                    title="Account"
                    action={
                      <span
                        className={cx(
                          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          !profileUserId ? "bg-[#f1f3f0] text-[#616a64]" : accountLive === "live" ? "bg-[#e3f1df] text-[#1f5131]" : accountLive === "offline" ? "bg-[#fdf0d2] text-[#6b4a05]" : "bg-[#f1f3f0] text-[#616a64]"
                        )}
                        title={accountLive === "live" ? "Changes from admins and your other devices appear instantly" : accountLive === "offline" ? "Live updates paused; refreshing every 10 seconds" : "Connecting"}
                        aria-live="polite"
                      >
                        <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                          {profileUserId && accountLive === "live" ? <span className="absolute inline-flex h-full w-full rounded-full bg-[#4caf6e] opacity-60 motion-safe:animate-ping" /> : null}
                          <span className={cx("relative inline-flex h-1.5 w-1.5 rounded-full", !profileUserId ? "bg-[#a9b0aa]" : accountLive === "live" ? "bg-[#2e7d4f]" : accountLive === "offline" ? "bg-[#d99a06]" : "bg-[#a9b0aa]")} />
                        </span>
                        {!profileUserId ? "Guest" : accountLive === "live" ? "Live" : accountLive === "offline" ? "Auto-refresh" : "Connecting"}
                      </span>
                    }
                  />
                  <dl className="mt-2 divide-y divide-[#f0f1ef] text-[13px]">
                    <div className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                      <dt className="text-[#616a64]">Language</dt>
                      <dd className="min-w-0 truncate text-right font-medium text-[#1a201c]">
                        {activeLanguage.flag} {activeLanguage.nativeName}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                      <dt className="text-[#616a64]">Worker code</dt>
                      <dd className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate font-mono text-[12.5px] font-medium text-[#1a201c]">{workerId || "Pending"}</span>
                        {workerId ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              const button = event.currentTarget;
                              void navigator.clipboard?.writeText(workerId).then(() => {
                                button.dataset.copied = "1";
                                window.setTimeout(() => delete button.dataset.copied, 1400);
                              });
                            }}
                            aria-label="Copy worker code"
                            className="group/copy rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-[#2b5d4a] transition hover:bg-[#eef1ed] data-[copied]:text-[#1f5131]"
                          >
                            <span className="group-data-[copied]/copy:hidden">Copy</span>
                            <span className="hidden group-data-[copied]/copy:inline">✓ Copied</span>
                          </button>
                        ) : null}
                      </dd>
                    </div>
                    {/* Linked social accounts (live) */}
                    <div className="px-4 py-2.5 sm:px-5">
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-[#616a64]">Linked accounts</dt>
                        <dd className="flex items-center gap-2">
                          {socialAccounts.load.state === "loading" ? (
                            <span className="h-4 w-6 animate-pulse rounded bg-[#eceeea]" aria-label="Loading" />
                          ) : (
                            <span className="font-medium tabular-nums text-[#1a201c]">{linkedAccounts.length}</span>
                          )}
                          <button type="button" onClick={() => navigateFromView("accounts")} className="rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold text-[#2b5d4a] transition hover:bg-[#eef1ed]">
                            {linkedAccounts.length || verifyingRequests.length ? "View" : "Add"}
                          </button>
                        </dd>
                      </div>
                      {linkedAccounts.length || verifyingRequests.length ? (
                        <ul className="mt-2 space-y-1.5">
                          {linkedAccounts.slice(0, 4).map((account) => {
                            const followers = metricChange(account.snapshots, "followers").value;
                            const isNew = minuteNow - Date.parse(account.linkedAt) < 10 * 60_000;
                            return (
                              <li key={account.id}>
                                <button
                                  type="button"
                                  onClick={() => navigateFromView("accounts")}
                                  className={cx(
                                    "flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-left transition hover:bg-[#fafbf9]",
                                    isNew ? "border-[#cfe3d4] bg-[#f4f9f2]" : "border-[#ebedea] bg-white"
                                  )}
                                >
                                  <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#eef1ed] text-[#2b5d4a]">
                                    <PlatformGlyph platform={accountPlatformFor(account.platform)} className="h-3.5 w-3.5" />
                                    <span className={cx("absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-white", account.status === "active" ? "bg-[#4caf6e]" : "bg-[#d99a06]")} aria-hidden="true" />
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[12.5px] font-semibold text-[#1a201c]">@{account.handle}</span>
                                    <span className="block truncate text-[11px] text-[#7a827c]">
                                      {account.status !== "active" ? "Paused · " : ""}
                                      {followers !== undefined ? `${formatCompactCount(followers)} followers` : account.gigTitle ?? account.platform}
                                    </span>
                                  </span>
                                  {isNew ? <span className="shrink-0 rounded-full bg-[#e3f1df] px-1.5 py-px text-[10px] font-semibold text-[#1f5131]">New</span> : null}
                                </button>
                              </li>
                            );
                          })}
                          {verifyingRequests.slice(0, 3).map((request) => (
                            <li key={request.id}>
                              <button
                                type="button"
                                onClick={() => navigateFromView("accounts")}
                                className="flex w-full items-center gap-2.5 rounded-lg border border-dashed border-[#d9ddd8] bg-[#fafbf9] px-2.5 py-1.5 text-left transition hover:bg-white"
                              >
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white text-[#7a827c] ring-1 ring-[#e3e5e1]">
                                  <PlatformGlyph platform={accountPlatformFor(request.platform)} className="h-3.5 w-3.5" />
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[12.5px] font-semibold text-[#3b443e]">@{request.handle}</span>
                                  <span className="flex items-center gap-1 text-[11px] text-[#7a827c]">
                                    <span className={cx("h-1.5 w-1.5 rounded-full", request.status === "changes_requested" ? "bg-[#d99a06]" : "bg-[#2a78d6] motion-safe:animate-pulse")} aria-hidden="true" />
                                    {REQUEST_STATUS_LABEL[request.status]}
                                  </span>
                                </span>
                              </button>
                            </li>
                          ))}
                          {linkedAccounts.length > 4 || verifyingRequests.length > 3 ? (
                            <li className="px-1 text-[11.5px] text-[#7a827c]">
                              +{Math.max(0, linkedAccounts.length - 4) + Math.max(0, verifyingRequests.length - 3)} more on the Linked page
                            </li>
                          ) : null}
                        </ul>
                      ) : socialAccounts.load.state !== "loading" ? (
                        <p className="mt-0.5 text-[12px] text-[#8a928c]">Accounts appear here the moment they&apos;re linked to a gig.</p>
                      ) : null}
                    </div>
                    {/* Older admin-assigned work accounts: only shown when there are some. */}
                    {assignedAccountsCount > 0 ? (
                      <div className={cx("px-4 py-2.5 transition-colors duration-700 sm:px-5", accountFlash.has("assigned") && "bg-[#f1f8ef]")}>
                        <div className="flex items-center justify-between gap-3">
                          <dt className="text-[#616a64]">Work accounts</dt>
                          <dd className="flex items-center gap-1.5 font-medium tabular-nums text-[#1a201c]">
                            {accountFlash.has("assigned") ? <span className="rounded-full bg-[#e3f1df] px-1.5 py-px text-[10.5px] font-semibold text-[#1f5131]">Updated</span> : null}
                            {assignedAccountsCount}
                          </dd>
                        </div>
                        {assignedAccounts.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {assignedAccounts.slice(0, 6).map((account) => (
                              <span key={account.id} className="max-w-full truncate rounded-md border border-[#e3e5e1] bg-[#fafbf9] px-2 py-0.5 text-[12px] text-[#1a201c]">
                                {account.handle || account.niche || account.id}
                              </span>
                            ))}
                            {assignedAccounts.length > 6 ? <span className="px-1 py-0.5 text-[12px] text-[#7a827c]">+{assignedAccounts.length - 6} more</span> : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                      <dt className="text-[#616a64]">Account access</dt>
                      <dd className="min-w-0 text-right">
                        <span className="block truncate font-medium text-[#1a201c]">{profileUserId ? "Signed in" : "Guest"}</span>
                        {profileUserId && accountSyncedAt ? <span className="block text-[11px] text-[#8a928c]">Updated {formatRelative(new Date(accountSyncedAt).toISOString())}</span> : null}
                      </dd>
                    </div>
                  </dl>
                </UiCard>
              </div>
            </div>

            <UiButton variant="critical" size="lg" onClick={logout} className="w-full sm:hidden">
              Sign out
            </UiButton>
          </div>
        </section>
      );
    }

    if (currentSection === "dashboard") {
      return (
        <section className="section-swipe-settle">
          <DashboardOverview
            firstName={dashboardFirstName}
            loading={gigsLoading || loading}
            gigs={gigs}
            openGigs={openGigs}
            applications={applications}
            assignments={normalizedAssignments}
            payoutBatches={payoutBatches}
            payoutSummary={payoutSummary}
            accountEarnings={accountEarnings}
            earningsLoading={earningsLoading}
            earningsError={earningsError}
            socialAccounts={socialAccounts.load.state === "ready" ? socialAccounts.load.accounts : []}
            socialAccountsLoading={socialAccounts.load.state === "loading"}
            socialAccountsError={socialAccounts.load.state === "error" ? socialAccounts.load.message : undefined}
            messages={messageThreads}
            unreadCount={unreadCount}
            profileChecklist={profileChecklist}
            profileCompletion={profileCompletion}
            onNavigate={navigateFromView}
          />
        </section>
      );
    }

    if (currentSection === "jobs") {
      return (
        <section className="section-swipe-settle">
          <DashboardJobsView
            loading={gigsLoading || loading}
            assignmentEntries={assignedJobEntries}
            applications={applications}
            gigById={gigById}
            openGigsCount={openGigs.length}
            pendingPayout={accountEarnings?.pending ?? payoutSummary.pending}
            earningsEstimate={Boolean(accountEarnings)}
            earningsLoading={earningsLoading}
            earningsUnavailable={socialAccounts.load.state === "error"}
            postingByGigId={jobPostingByGigId}
            buildDetailHref={(gig) => findGigHref(String(gig.id))}
            onNavigate={navigateFromView}
          />
        </section>
      );
    }

    if (currentSection === "find") {
      const pendingGigId = selectedGigId ?? directApplyLaunchGigId;
      if (pendingGigId && (!gigById.has(pendingGigId) || loading || profileLoading)) {
        return <GigDetailPending
          loading={loading || profileLoading || gigsLoading || liveSyncing}
          failed={Boolean(error)}
          onBack={() => navigateFromView("find")}
          onRetry={() => { void refreshLiveData(true); }}
        />;
      }
      if (selectedGig) {
        const detailBrief = getGigBrief(selectedGig);
        const detailRequirements = getGigRequirementItems(selectedGig);
        const detailMeta = getGigMeta(selectedGig);
        const detailLocation = compactLocationLabel(selectedGig.location);
        const detailPayoutMeta = selectedGig.payoutType ?? selectedGig.gigType ?? "per campaign";
        const detailDate = formatDetailedDate(selectedGig.postedAt);
        const detailDateLabel = detailDate !== "Unavailable" ? detailDate : selectedGig.postedAt || "Recently listed";
        const detailType = detailMeta.category || formatGigTypeLabel(selectedGig.gigType);
        const detailLevel = detailMeta.level || "Open level";
        const payoutLabel = /month/i.test(detailPayoutMeta) ? "Monthly rate" : detailPayoutMeta;
        const detailPayout = splitPayout(selectedGig.payout);
        const gigIsOpen = String(selectedGig.status ?? "").trim().toLowerCase() === "open";
        const detailDescription = (detailBrief ? detailBrief.split(/\n+/) : [gigCardSummary(selectedGig)])
          .map((item) => String(item).trim())
          .filter(Boolean);
        const briefIsLong = detailDescription.length > 3 || detailDescription.join(" ").length > 900;
        const briefExpanded = expandedBriefGigId === selectedGig.id;
        const visibleDescription = briefIsLong && !briefExpanded ? detailDescription.slice(0, 3) : detailDescription;
        const postedRelative = formatRelative(selectedGig.postedAt);
        const closeGigDetail = () => {
          writeDashboardSectionToUrl("find");
          setSelectedGigId(null);
          setSelectedGigIntent("details");
          setDirectApplyGigId(null);
          setDirectApplyLaunchGigId(null);
          setProposalDeskOpen(false);
        };
        const copyGigLink = async () => {
          const url = `${window.location.origin}${findGigHref(String(selectedGig.id))}`;
          try {
            await navigator.clipboard.writeText(url);
            setCopiedGigLinkId(String(selectedGig.id));
            window.setTimeout(() => setCopiedGigLinkId((current) => (current === String(selectedGig.id) ? null : current)), 1800);
          } catch {
            // clipboard unavailable (insecure context or denied permission)
          }
        };
        const linkCopied = copiedGigLinkId === String(selectedGig.id);
        const applicationMode = getDashboardApplicationMode(selectedGig);
        const isDirectApplicationFlow = applicationMode === "apply";
        const requiresBudget = isProjectGig(selectedGig) || isContentPostingGig(selectedGig) || isCustomGig(selectedGig);
        const hasApplication = !!selectedGigApplication;
        const canReviseProposal = !isDirectApplicationFlow && selectedGigReviewStatus === "Rejected";
        const applicationLocked = hasApplication && (isDirectApplicationFlow || !canReviseProposal);
        // Content Posting: after applying, the creator sets up the account they'll post from; screening waits for it.
        const needsAccountSetup = isContentPostingGig(selectedGig) && hasApplication && selectedGigReviewStatus !== "Rejected";
        const accountSetup = selectedGigApplication?.proposal?.accountSetup;
        // A submitted account whose bio doesn't show the code yet is still waiting on the creator.
        const accountCodeMissing = accountSetup?.status === "Submitted" && accountSetup.ownership === "missing";
        const accountActionNeeded = needsAccountSetup && selectedGigReviewStatus !== "Accepted" && (!accountSetup || accountSetup.status === "ChangesRequested" || accountCodeMissing);
        const accountPlatformLabel = accountPlatformFor(selectedGig.platform).label;
        const proposalStatusLabel =
          selectedGigReviewStatus === "Accepted"
            ? "Approved"
            : selectedGigReviewStatus === "Rejected"
              ? isDirectApplicationFlow
                ? "Closed"
                : "Revision requested"
              : accountActionNeeded
                ? "Action needed"
                : hasApplication
                  ? isDirectApplicationFlow
                    ? "In screening"
                    : "In review"
                  : "Ready";
        const proposalSubmittedAt = selectedGigApplication?.proposal?.submittedAt ?? selectedGigApplication?.appliedAt ?? null;
        const recruiterNote = String(selectedGigApplication?.proposal?.adminNote ?? "").trim();
        const recruiterExplanation = String(selectedGigApplication?.proposal?.adminExplanation ?? "").trim();
        const proposalTimelineLabel = requiresBudget ? "Delivery timeline" : "Availability";
        const proposalBudgetLabel = isContentPostingGig(selectedGig) ? "Quoted rate" : "Quoted budget";
        // Email Creator gigs need no approval: the main action starts the work panel directly.
        const startsWorkDirectly = isEmailCreatorGig(selectedGig);
        const hasWorkAssignment = assignmentByGigId.has(String(selectedGig.id));
        // New applications (and revisions of ones no longer counted) wait while this week's slots are used.
        const detailLimitBlock = !hasWorkAssignment && !applicationLocked ? weeklyLimitBlock(String(selectedGig.id)) : null;
        const limitNotice = detailLimitBlock ? (
          <div role="status" className="flex items-start gap-2.5 rounded-lg border border-[#f0d9a8] bg-[#fffaf0] px-3.5 py-3 text-[13px] leading-5 text-[#6b4a05]">
            <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="13" r="8" />
              <path d="M12 9v4l2.5 2" />
            </svg>
            <span className="min-w-0">
              <span className="block font-semibold">Weekly application limit reached</span>
              {detailLimitBlock} You can still read the brief and save it for then.
            </span>
          </div>
        ) : null;
        const primaryApplicationActionLabel = detailLimitBlock
          ? `Opens in ${formatWait(weeklyQuota.nextSlotAt, minuteNow)}`
          : startsWorkDirectly
          ? hasWorkAssignment || hasApplication
            ? "Open your work"
            : "Apply now"
          : applicationLocked
          ? accountActionNeeded
            ? accountSetup?.status === "ChangesRequested"
              ? `Update ${accountPlatformLabel} account`
              : accountCodeMissing
                ? `Verify ${accountPlatformLabel} account`
                : `Set up ${accountPlatformLabel} account`
            : "View application status"
          : isDirectApplicationFlow
            ? "Apply now"
            : proposalDeskOpen
              ? "Go to proposal section"
              : "Open proposal section";

        return (
          <section className="section-swipe-settle mx-auto w-full max-w-[1440px]">
            {/* Breadcrumb + page actions */}
            <div className="flex min-w-0 items-center justify-between gap-3">
              <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-[13px]">
                <button
                  type="button"
                  onClick={closeGigDetail}
                  aria-label="Back to gigs"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#4b544e] transition hover:bg-[#e9ebe7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40"
                >
                  <UiIcon.ChevronLeft className="h-5 w-5" />
                </button>
                <button type="button" onClick={closeGigDetail} className="shrink-0 rounded-md px-1 font-medium text-[#616a64] transition hover:text-[#1a201c]">
                  Find gigs
                </button>
                <UiIcon.ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#a3aaa4]" />
                <span aria-current="page" className="min-w-0 truncate font-medium text-[#1a201c]">
                  {selectedGig.title}
                </span>
              </nav>
              <UiButton size="sm" onClick={copyGigLink} aria-live="polite">
                {linkCopied ? <UiIcon.Check className="h-3.5 w-3.5 text-[#2e7d4f]" /> : <UiIcon.External />}
                <span className="hidden min-[420px]:inline">{linkCopied ? "Link copied" : "Copy link"}</span>
                <span className="min-[420px]:hidden">{linkCopied ? "Copied" : "Share"}</span>
              </UiButton>
            </div>

            <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-5">
              <DashboardReveal delay={110} className="min-w-0 space-y-4">
                {/* Overview */}
                <article className="gig-detail-card gig-detail-hero p-4 sm:p-6">
                  <div className="flex items-start gap-3 sm:gap-4">
                    <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-[#e3e5e1] bg-[#fafbf9] text-[15px] font-bold text-[#2b5d4a] sm:flex" aria-hidden="true">
                      {getInitials(selectedGig.company)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#e3e5e1] bg-[#fafbf9] text-[11px] font-bold text-[#2b5d4a] sm:hidden" aria-hidden="true">
                          {getInitials(selectedGig.company)}
                        </span>
                        <span className="text-[13.5px] font-semibold text-[#1a201c]">{selectedGig.company}</span>
                        {selectedGig.verified ? (
                          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[#2e7d4f]">
                            <UiIcon.Check className="h-3.5 w-3.5" />
                            Verified
                          </span>
                        ) : null}
                        <StatusBadge status={gigIsOpen ? "Hiring now" : formatStatusLabel(selectedGig.status)} tone={gigIsOpen ? "success" : "attention"} />
                      </div>
                      <h1 className="mt-1.5 text-balance text-[clamp(1.3rem,2.8vw,1.75rem)] font-semibold leading-[1.2] tracking-[-0.015em] text-[#1a201c]">
                        {selectedGig.title}
                      </h1>
                      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-[#616a64]" aria-label="Gig details">
                        <li className="inline-flex items-center gap-1.5">
                          <LocationPinIcon className="h-4 w-4 text-[#8a928c]" />
                          {detailLocation}
                        </li>
                        <li className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-[#8a928c]" aria-hidden="true" />
                          {selectedGig.platform}
                        </li>
                        <li className="inline-flex items-center gap-1.5">
                          <UiIcon.Wallet className="h-4 w-4 text-[#8a928c]" />
                          {detailPayoutMeta}
                        </li>
                        <li className="inline-flex items-center gap-1.5" title={detailDateLabel}>
                          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4 text-[#8a928c]" aria-hidden="true">
                            <rect x="3.5" y="4.5" width="13" height="12" rx="2" />
                            <path d="M3.5 8.5h13M7 3v3M13 3v3" strokeLinecap="round" />
                          </svg>
                          Posted {postedRelative !== "Just now" && postedRelative.endsWith("ago") ? postedRelative : detailDateLabel}
                        </li>
                      </ul>
                    </div>
                  </div>

                  {!gigIsOpen ? (
                    <div role="status" className="mt-4 rounded-lg border border-[#f1dea6] bg-[#fff8e1] px-3.5 py-2.5 text-[13px] font-medium text-[#6b4a05]">
                      This gig is {formatStatusLabel(selectedGig.status).toLowerCase()} right now. New applications may not be reviewed until it reopens.
                    </div>
                  ) : null}
                </article>

                {/* Phone/tablet: payout + primary action near the top */}
                <article className="gig-detail-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between lg:hidden">
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium text-[#616a64]">Payout</div>
                    <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                      <span className="whitespace-nowrap text-[24px] font-semibold leading-tight tracking-[-0.01em] text-[#1a201c]">{detailPayout.amount}</span>
                      <span className="text-[13px] text-[#616a64]">{detailPayout.unit || payoutLabel}</span>
                    </div>
                    {hasApplication ? (
                      <div className="mt-2">
                        <StatusBadge status={proposalStatusLabel} />
                      </div>
                    ) : null}
                  </div>
                  <UiButton
                    variant="primary"
                    size="lg"
                    className="w-full sm:w-auto sm:px-6"
                    disabled={!!detailLimitBlock}
                    title={detailLimitBlock ?? undefined}
                    onClick={() => {
                      if (startsWorkDirectly && (hasApplication || hasWorkAssignment)) {
                        requestGigWorkStart(String(selectedGig.id));
                        return;
                      }
                      if (isDirectApplicationFlow && !applicationLocked) {
                        void openDashboardDirectApplyModal();
                        return;
                      }
                      scrollToProposalDesk(!applicationLocked);
                    }}
                  >
                    {primaryApplicationActionLabel}
                  </UiButton>
                </article>

                {/* Key facts */}
                <dl className="grid grid-cols-3 divide-x divide-[#ebedea] overflow-hidden rounded-xl border border-[#e3e5e1] bg-white shadow-[0_1px_0_rgba(26,32,28,0.04),0_1px_2px_rgba(26,32,28,0.06)]">
                  {[
                    { label: "Project type", value: detailType },
                    { label: "Duration", value: selectedGig.workload || "Flexible" },
                    { label: "Level", value: detailLevel },
                  ].map((fact) => (
                    <div key={fact.label} className="min-w-0 px-3 py-3 sm:px-4 sm:py-3.5">
                      <dt className="truncate text-[11.5px] font-medium text-[#616a64] sm:text-[12px]">{fact.label}</dt>
                      <dd className="mt-1 line-clamp-2 text-[13px] font-semibold leading-snug text-[#1a201c] sm:text-[14px]" title={String(fact.value)}>
                        {fact.value}
                      </dd>
                    </div>
                  ))}
                </dl>

                {/* Sample videos the brand attached ("see the work"), before the written brief. */}
                <GigSampleReel samples={parseGigSamples(selectedGig.requirements)} company={selectedGig.company} />

                {/* Description */}
                <article className="gig-detail-card p-4 sm:p-6" aria-labelledby="gig-description-title">
                  <h2 id="gig-description-title" className="gig-section-title">
                    About this gig
                  </h2>
                  <div className="relative">
                    <div id="gig-description-body" className="mt-3 max-w-[72ch] space-y-3.5 text-[14.5px] leading-7 text-[#3b443e] sm:text-[15px]">
                      {visibleDescription.map((paragraph, index) => (
                        <p key={`${paragraph}-${index}`}>{paragraph}</p>
                      ))}
                    </div>
                    {briefIsLong && !briefExpanded ? (
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white to-white/0" aria-hidden="true" />
                    ) : null}
                  </div>
                  {briefIsLong ? (
                    <button
                      type="button"
                      onClick={() => setExpandedBriefGigId(briefExpanded ? null : String(selectedGig.id))}
                      aria-expanded={briefExpanded}
                      aria-controls="gig-description-body"
                      className="mt-2 inline-flex items-center gap-1 rounded-md text-[13px] font-semibold text-[#2b5d4a] transition hover:text-[#1d4536] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40"
                    >
                      {briefExpanded ? "Show less" : "Read more"}
                      <UiIcon.ChevronDown className={cx("h-4 w-4 transition-transform", briefExpanded && "rotate-180")} />
                    </button>
                  ) : null}

                  {detailRequirements.length > 0 ? (
                    <div className="mt-6 border-t border-[#ebedea] pt-5">
                      <h3 className="text-[14px] font-semibold text-[#1a201c]">What you&apos;ll need</h3>
                      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                        {detailRequirements.map((requirement, index) => (
                          <li key={`${requirement}-${index}`} className="flex items-start gap-2.5 rounded-lg bg-[#fafbf9] px-3 py-2.5 text-[13.5px] leading-6 text-[#3b443e] ring-1 ring-inset ring-[#ebedea]">
                            <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#e3f1df] text-[#2e7d4f]" aria-hidden="true">
                              <UiIcon.Check className="h-2.5 w-2.5" />
                            </span>
                            {requirement}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </article>

                <article
                  ref={proposalDeskRef}
                  aria-labelledby="gig-application-title"
                  className={cx("gig-detail-card scroll-mt-24 overflow-hidden", proposalDeskOpen && !applicationLocked ? "gig-detail-card--active" : "")}
                >
                  {(() => {
                    const fieldClass =
                      "mt-1.5 w-full rounded-lg border border-[#d9ddd8] bg-white px-3 text-[16px] text-[#1a201c] shadow-[0_1px_2px_rgba(26,32,28,0.04)] outline-none transition placeholder:text-[#8a928c] focus:border-[#7fa58c] focus:ring-2 focus:ring-[#2e7d4f]/20 sm:text-[14px]";
                    const reviewDone = selectedGigReviewStatus === "Accepted" || selectedGigReviewStatus === "Rejected";
                    const trackerSteps: Array<{ label: string; state: "done" | "current" | "todo" | "failed" }> = [
                      { label: isDirectApplicationFlow ? "Applied" : "Submitted", state: "done" },
                      ...(needsAccountSetup
                        ? [{ label: "Account", state: (accountActionNeeded ? "current" : "done") as "current" | "done" }]
                        : []),
                      { label: isDirectApplicationFlow ? "Screening" : "In review", state: reviewDone ? "done" : accountActionNeeded ? "todo" : "current" },
                      {
                        label: selectedGigReviewStatus === "Accepted" ? "Approved" : selectedGigReviewStatus === "Rejected" ? (isDirectApplicationFlow ? "Closed" : "Changes requested") : "Decision",
                        state: selectedGigReviewStatus === "Accepted" ? "done" : selectedGigReviewStatus === "Rejected" ? "failed" : "todo",
                      },
                    ];
                    const pitchLength = proposalPitch.trim().length;
                    const requirementsList = [
                      { label: "Proposal note", done: pitchLength > 0 },
                      { label: proposalTimelineLabel, done: proposalTimeline.trim().length > 0 },
                      ...(requiresBudget ? [{ label: proposalBudgetLabel, done: proposalBudget.trim().length > 0 }] : []),
                    ];
                    const requiredDone = requirementsList.filter((item) => item.done).length;
                    const previousProposal = canReviseProposal ? selectedGigApplication?.proposal : undefined;
                    const fieldChanged = (current: string, previous?: string) => !!previousProposal && current.trim() !== String(previous ?? "").trim();
                    const pitchEdited = fieldChanged(proposalPitch, previousProposal?.pitch);
                    const timelineEdited = fieldChanged(proposalTimeline, previousProposal?.timeline);
                    const budgetEdited = requiresBudget && fieldChanged(proposalBudget, previousProposal?.budget);
                    const portfolioEdited = fieldChanged(proposalPortfolio, previousProposal?.portfolio);
                    const editedCount = [pitchEdited, timelineEdited, budgetEdited, portfolioEdited].filter(Boolean).length;
                    const editedPill = (edited: boolean) =>
                      edited ? <span className="ml-1.5 rounded-full bg-[#e0ecf8] px-1.5 py-px text-[10.5px] font-semibold text-[#1f4a73]">Edited</span> : null;
                    const feedbackMessages = [
                      { label: "Feedback", body: recruiterNote },
                      { label: "Requested changes", body: recruiterExplanation },
                    ].filter((message) => message.body);
                    const timelinePresets = requiresBudget ? ["Within 3 days", "1 week", "2 weeks", "Ongoing monthly"] : ["Start today", "Within 24 hours", "This week", "Flexible"];
                    const approvedOn = selectedGigApplication?.proposal?.reviewedAt;
                    const headerTitle = applicationLocked
                      ? selectedGigReviewStatus === "Accepted"
                        ? isDirectApplicationFlow ? "Application approved" : "Proposal approved"
                        : "Your application"
                      : isDirectApplicationFlow
                        ? "Apply to this gig"
                        : canReviseProposal
                          ? "Revise your proposal"
                          : "Send a proposal";
                    const headerDescription = applicationLocked
                      ? selectedGigReviewStatus === "Accepted"
                        ? `${selectedGig.company} approved your ${isDirectApplicationFlow ? "application" : "proposal"}${approvedOn ? ` on ${formatDetailedDate(approvedOn)}` : ""}. Review your progress and next steps below.`
                        : selectedGigReviewStatus === "Rejected"
                          ? isDirectApplicationFlow
                            ? "This application was closed by the hiring team. Review any recruiter notes below."
                            : "Your proposal needs changes before it can move forward."
                          : accountActionNeeded
                            ? accountSetup?.status === "ChangesRequested"
                              ? `The hiring team asked for a change to your ${accountPlatformLabel} account. Update it below to continue screening.`
                              : accountCodeMissing
                                ? `Almost there: add your verification code to the ${accountPlatformLabel} bio so the team can confirm the account is yours.`
                                : `One more step: set up the ${accountPlatformLabel} account you'll post reels on. Screening starts as soon as it's in.`
                            : startsWorkDirectly
                            ? "Approved instantly. Your work emails and inbox are in Your assignment below."
                            : isDirectApplicationFlow
                            ? "Your application is in recruiter screening. Every update will appear here."
                            : "Your proposal is under review. The next update from the hiring team will appear here."
                      : canReviseProposal
                        ? "The hiring team asked for changes. Update the details below and send a revised proposal."
                        : startsWorkDirectly
                          ? "One step: apply and you're approved instantly. Your work emails open right away."
                          : isDirectApplicationFlow
                          ? "One step: confirm and your profile goes straight to recruiter screening."
                          : "Share a short note, your timeline and rate. The hiring team replies here.";

                    return (
                      <>
                        {/* Header */}
                        <div className="flex flex-col gap-3 border-b border-[#ebedea] px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6 sm:py-5">
                          <div className="flex min-w-0 items-start gap-3">
                            {selectedGigReviewStatus === "Accepted" ? (
                              <span className="dashboard-success-badge relative mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#2e7d4f] text-white" aria-hidden="true">
                                <span className="dashboard-success-ring absolute inset-0 rounded-full border-2 border-[#2e7d4f]/40" />
                                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                                  <path className="dashboard-success-check" d="m5.5 12.5 4.2 4.2L18.5 7.8" />
                                </svg>
                              </span>
                            ) : (
                              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#eef1ed] text-[#2b5d4a]" aria-hidden="true">
                                <UiIcon.Clipboard className="h-[18px] w-[18px]" />
                              </span>
                            )}
                            <div className="min-w-0">
                              <h2 id="gig-application-title" className="text-[16px] font-semibold text-[#1a201c]">
                                {headerTitle}
                              </h2>
                              <p className="mt-0.5 max-w-[60ch] text-[13px] leading-5 text-[#616a64]">{headerDescription}</p>
                            </div>
                          </div>
                          <span className="self-start pl-12 sm:pl-0">
                            <StatusBadge status={proposalStatusLabel} />
                          </span>
                        </div>

                        <div className="px-4 py-4 sm:px-6 sm:py-5">
                          {proposalSuccess ? (
                            <div role="status" className="mb-4 flex items-start gap-2 rounded-lg border border-[#cfe6c9] bg-[#f1f8ef] px-3.5 py-2.5 text-[13px] text-[#1f5131]">
                              <UiIcon.Check className="mt-0.5 h-4 w-4 shrink-0" />
                              {proposalSuccess}
                            </div>
                          ) : null}
                          {proposalError ? (
                            <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-[#f3cdc8] bg-[#fdf2f1] px-3.5 py-2.5 text-[13px] text-[#8e1f1a]">
                              <UiIcon.Close className="mt-0.5 h-4 w-4 shrink-0" />
                              {proposalError}
                            </div>
                          ) : null}

                          {applicationLocked ? (
                            /* ---------------- Status view ---------------- */
                            <div className="space-y-5">
                              {proposalReceipt && proposalReceipt.gigId === String(selectedGig.id) ? (
                                <div role="status" className="dashboard-sheet-rise relative rounded-xl border border-[#b9d5c0] bg-[#f1f8ef] p-4 sm:p-5">
                                  <button
                                    type="button"
                                    onClick={() => setProposalReceipt(null)}
                                    aria-label="Dismiss"
                                    className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#4b544e] transition hover:bg-[#e3efe0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40"
                                  >
                                    <UiIcon.Close className="h-3.5 w-3.5" />
                                  </button>
                                  <div className="flex items-start gap-3 pr-8">
                                    <span className="dashboard-success-badge relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white ring-1 ring-[#b9d5c0]" aria-hidden="true">
                                      <span className="dashboard-success-ring absolute inset-0 rounded-full border-2 border-[#2e7d4f]/30" />
                                      <svg viewBox="0 0 24 24" className="h-5 w-5 text-[#2e7d4f]" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                                        <path className="dashboard-success-check" d="m5.5 12.5 4.2 4.2L18.5 7.8" />
                                      </svg>
                                    </span>
                                    <div className="min-w-0">
                                      <h3 className="text-[15px] font-semibold text-[#1a201c]">{proposalReceipt.revision ? "Revision sent" : "Proposal sent"}</h3>
                                      <p className="mt-0.5 text-[13px] leading-5 text-[#3b443e]">
                                        {selectedGig.company} {proposalReceipt.revision ? "will review your updated proposal" : "will review your proposal"}. Replies appear on this page and in Messages.
                                      </p>
                                    </div>
                                  </div>
                                  <div className="mt-4 flex flex-col gap-2 min-[420px]:flex-row">
                                    <UiButton variant="primary" size="sm" className="w-full min-[420px]:w-auto" onClick={() => { setProposalReceipt(null); navigateFromView("jobs"); }}>
                                      Track in Jobs
                                    </UiButton>
                                    <UiButton size="sm" className="w-full min-[420px]:w-auto" onClick={() => { setProposalReceipt(null); navigateFromView("find"); }}>
                                      Browse more gigs
                                    </UiButton>
                                  </div>
                                </div>
                              ) : null}

                              {selectedGigReviewStatus !== "Accepted" ? (
                              <ol className={cx("grid gap-2", trackerSteps.length === 4 ? "grid-cols-4" : "grid-cols-3")} aria-label="Application progress">
                                {trackerSteps.map((step) => (
                                  <li key={step.label} className="min-w-0">
                                    <div
                                      className={cx(
                                        "h-1.5 rounded-full",
                                        step.state === "done" && "bg-[#2e7d4f]",
                                        step.state === "current" && "bg-[linear-gradient(90deg,#2e7d4f,#cfe3d4)]",
                                        step.state === "failed" && "bg-[#e7a19a]",
                                        step.state === "todo" && "bg-[#eaece8]"
                                      )}
                                    />
                                    <div
                                      className={cx(
                                        "mt-2 flex items-center gap-1.5 text-[12.5px] font-semibold",
                                        step.state === "todo" ? "text-[#9aa29c]" : step.state === "failed" ? "text-[#b42318]" : "text-[#1a201c]"
                                      )}
                                    >
                                      {step.state === "done" ? <UiIcon.Check className="h-3.5 w-3.5 shrink-0 text-[#2e7d4f]" /> : null}
                                      {step.state === "current" ? <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[#2e7d4f]" aria-hidden="true" /> : null}
                                      {step.state === "failed" ? <UiIcon.Close className="h-3.5 w-3.5 shrink-0" /> : null}
                                      <span className="truncate">{step.label}</span>
                                    </div>
                                  </li>
                                ))}
                              </ol>
                              ) : null}

                              {selectedGigReviewStatus !== "Accepted" ? (
                              <dl className="grid grid-cols-2 divide-x divide-[#ebedea] overflow-hidden rounded-lg border border-[#ebedea] bg-[#fafbf9] text-[13px] sm:grid-cols-3">
                                <div className="min-w-0 px-3.5 py-3">
                                  <dt className="text-[12px] text-[#616a64]">{isDirectApplicationFlow ? "Applied" : "Submitted"}</dt>
                                  <dd className="mt-0.5 truncate font-semibold text-[#1a201c]">{proposalSubmittedAt ? formatDetailedDate(proposalSubmittedAt) : "Recently"}</dd>
                                </div>
                                <div className="min-w-0 px-3.5 py-3">
                                  <dt className="text-[12px] text-[#616a64]">Status</dt>
                                  <dd className="mt-0.5 truncate font-semibold text-[#1a201c]">{proposalStatusLabel}</dd>
                                </div>
                                <div className="col-span-2 min-w-0 border-t border-[#ebedea] px-3.5 py-3 sm:col-span-1 sm:border-t-0">
                                  <dt className="text-[12px] text-[#616a64]">Type</dt>
                                  <dd className="mt-0.5 truncate font-semibold text-[#1a201c]">{isDirectApplicationFlow ? "Quick apply" : "Proposal"}</dd>
                                </div>
                              </dl>
                              ) : null}

                              {needsAccountSetup && selectedGigApplication && !(selectedGigReviewStatus === "Accepted" && accountSetup?.status === "Verified") ? (
                                <div id={ACCOUNT_SETUP_ANCHOR} tabIndex={-1} className="scroll-mt-24 rounded-2xl outline-none">
                                <AccountSetupPanel
                                  key={selectedGigApplication.id}
                                  gig={selectedGig}
                                  application={selectedGigApplication}
                                  onOpenStats={() => navigateFromView("accounts")}
                                  onUpdated={(updated) => {
                                    setApplications((previous) => {
                                      const next = previous.map((item) => (String(item.id) === String(updated.id) ? ({ ...item, ...updated } as GigApplication) : item));
                                      writeCachedGigApplications(next);
                                      return next;
                                    });
                                  }}
                                />
                                </div>
                              ) : null}

                              {selectedGigReviewStatus === "Accepted"
                                ? (() => {
                                    const proposal = selectedGigApplication?.proposal;
                                    const groupLink = /^https:\/\//i.test(String(proposal?.whatsappLink ?? "").trim()) ? String(proposal?.whatsappLink).trim() : null;
                                    const groupJoined = !!proposal?.groupJoinedConfirmed;
                                    const assignment = assignmentByGigId.get(String(selectedGig.id)) ?? null;
                                    const onboardingItems = String(proposal?.onboardingSteps ?? "")
                                      .split(/\n+/)
                                      .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim())
                                      .filter(Boolean);
                                    // Content Posting work happens on the linked account: post reels, submit them, get paid per approval.
                                    const matchesSelectedGig = (account: (typeof linkedAccounts)[number]) => String(account.gigId) === String(selectedGig.id) || (!!selectedGigApplication && String(account.applicationId) === String(selectedGigApplication.id));
                                    const gigAccount = linkedAccounts.find((account) => account.status !== "unlinked" && matchesSelectedGig(account)) ?? null;
                                    const profileIssue = socialAccounts.load.state === "ready" ? socialAccounts.load.accountIssues?.find(matchesSelectedGig) ?? null : null;
                                    const needsProfileFix = !gigAccount && !!profileIssue;
                                    const linkedHandle = gigAccount?.handle ?? (!profileIssue && accountSetup?.status === "Verified" ? accountSetup.handle : null);
                                    const reelPay = payoutPhrase(selectedGig.payout, selectedGig.payoutType);
                                    const posting = postingProgress(gigAccount ?? profileIssue, payoutBatches);
                                    const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
                                    const money = (amount: number) => formatMoney(amount, posting.symbol);
                                    type StepStat = { label: string; tone: "neutral" | "good" | "wait" | "bad" };
                                    type NextStep = { title: string; body: string; done: boolean; action?: { label: string; onClick: () => void }; stats?: StepStat[]; amount?: { value: string; caption: string } };
                                    const steps: NextStep[] = [
                                      { title: "Approved", body: `${selectedGig.company} accepted your ${isDirectApplicationFlow ? "application" : "proposal"}.`, done: true },
                                      ...(groupLink
                                        ? [{ title: "Join the onboarding group", body: groupJoined ? "You've confirmed you joined." : "Get briefs and instructions from the hiring team.", done: groupJoined }]
                                        : []),
                                      ...(isContentPostingGig(selectedGig)
                                        ? [
                                            {
                                              title: needsProfileFix ? `Verify your ${accountPlatformLabel} account` : `${accountPlatformLabel} account linked`,
                                              body: needsProfileFix ? "Your profile could not be found. Check your username and verify your account to link it again." : linkedHandle ? `@${linkedHandle}, verified` : "Your account is being linked to your profile.",
                                              done: !!linkedHandle,
                                              action: needsProfileFix ? { label: "Verify account", onClick: () => navigateFromView("accounts") } : undefined,
                                            },
                                            {
                                              title: "Post reels and submit them",
                                              body: needsProfileFix
                                                ? "Your submitted reels are saved. Verify your profile to continue posting."
                                                : posting.submitted
                                                ? "Keep posting: every approved reel counts."
                                                : earningsLoading
                                                  ? "Checking your submitted reels…"
                                                  : `Post the brief's reels on ${linkedHandle ? `@${linkedHandle}` : "the account"}, then send each reel's link from ${strings.nav.accounts} so it counts.`,
                                              done: posting.submitted > 0,
                                              stats: posting.submitted || posting.rejected
                                                ? ([
                                                    { label: `${posting.submitted} submitted`, tone: "neutral" },
                                                    posting.approved ? { label: `${posting.approved} approved`, tone: "good" } : null,
                                                    posting.inReview ? { label: `${posting.inReview} in review`, tone: "wait" } : null,
                                                    posting.rejected ? { label: `${posting.rejected} not accepted`, tone: "bad" } : null,
                                                  ].filter(Boolean) as StepStat[])
                                                : undefined,
                                              action: posting.submitted ? undefined : { label: `Open ${strings.nav.accounts}`, onClick: () => navigateFromView("accounts") },
                                            },
                                            {
                                              title: posting.paid ? "Getting paid" : posting.earned || posting.inPayout ? "Earning from approved reels" : "Get paid for approved reels",
                                              body: posting.paid
                                                ? posting.inPayout ? `${money(posting.inPayout)} more is in the current payout.` : "Paid to your wallet. New approvals join the next cycle."
                                                : posting.inPayout
                                                  ? "In the current payout cycle. It lands in your wallet once it's paid."
                                                  : posting.earned
                                                    ? "Credited to your wallet in the next payout cycle."
                                                    : `${reelPay ? `You earn ${reelPay}` : "Approved reels are paid"}, credited to your wallet after the team's review.`,
                                              // Earning counts as done: approved reels are already worth money, paid out each cycle.
                                              done: posting.paid > 0 || posting.inPayout > 0 || posting.earned > 0,
                                              amount: posting.paid
                                                ? { value: money(posting.paid), caption: "paid so far" }
                                                : posting.inPayout
                                                  ? { value: money(posting.inPayout), caption: "in this payout" }
                                                  : posting.earned
                                                    ? { value: money(posting.earned), caption: `earned from ${plural(posting.approved, "approved reel")}` }
                                                    : undefined,
                                              action: posting.approved || posting.paid || posting.inPayout ? { label: `Open ${strings.nav.wallet}`, onClick: () => navigateFromView("wallet") } : undefined,
                                            },
                                          ]
                                        : [
                                            {
                                              title: "Receive your assignment",
                                              body: assignment ? `Assigned · ${assignment.statusLabel}` : "The hiring team will assign your first task here.",
                                              done: !!assignment,
                                            },
                                            { title: "Deliver and get paid", body: `Earnings (${selectedGig.payout}) move to your wallet after approval.`, done: false },
                                          ]),
                                    ];
                                    const nextIndex = steps.findIndex((step) => !step.done);
                                    return (
                                      <div className="-mx-4 overflow-hidden border-y border-[#b9d5c0] sm:mx-0 sm:rounded-xl sm:border-x">
                                        <div className="@container bg-white">
                                          <div className="grid @2xl:grid-cols-[minmax(0,1fr)_15rem]">
                                            {/* Next steps: a connected tracker; the step to do now is raised with its action. */}
                                            <section aria-labelledby={`next-steps-${selectedGig.id}`} className="min-w-0 p-4 sm:p-5">
                                              <div className="flex items-center justify-between gap-3">
                                                <h4 id={`next-steps-${selectedGig.id}`} className="text-[14px] font-semibold text-[#1a201c]">{nextIndex === -1 ? "Your progress" : "Your next steps"}</h4>
                                                {nextIndex === -1 ? (
                                                  <span className="inline-flex items-center gap-1 rounded-full bg-[#e3f1df] px-2 py-0.5 text-[11.5px] font-semibold text-[#1f5131]"><UiIcon.Check className="h-3 w-3" />All set</span>
                                                ) : (
                                                  <span className="text-[12px] font-medium tabular-nums text-[#616a64]">{steps.filter((step) => step.done).length} of {steps.length} done</span>
                                                )}
                                              </div>
                                              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#eef1ed]" aria-hidden="true">
                                                <div className="h-full rounded-full bg-[#2e7d4f] transition-[width] duration-500" style={{ width: `${(steps.filter((step) => step.done).length / steps.length) * 100}%` }} />
                                              </div>
                                              <ol className="mt-4">
                                                {steps.map((step, index) => {
                                                  const current = index === nextIndex;
                                                  const last = index === steps.length - 1;
                                                  const groupAction = step.title === "Join the onboarding group" && groupLink && !groupJoined;
                                                  // Finished steps without extra detail fold into one quiet line; detail and the current step get room.
                                                  const compact = step.done && !step.stats && !step.amount && !step.action;
                                                  const buttonClass = current ? buttonClassName("primary", "sm", "h-10 w-full @md:h-9 @md:w-auto") : "inline-flex min-h-8 items-center gap-1 rounded-md text-[12.5px] font-semibold text-[#2e7d4f] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[#2e7d4f]";
                                                  return (
                                                    <li key={step.title} className="relative flex gap-3">
                                                      {last ? null : <span aria-hidden="true" className={cx("absolute bottom-0 left-[11px] w-px", compact ? "top-7" : "top-8", step.done ? "bg-[#9cc9a8]" : "bg-[#e3e7df]")} />}
                                                      <span
                                                        className={cx(
                                                          "relative z-[1] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold",
                                                          compact ? "mt-1" : current ? "mt-3" : "mt-1.5",
                                                          step.done ? "bg-[#2e7d4f] text-white" : current ? "bg-[#1f2b24] text-white ring-4 ring-[#1f2b24]/10" : "border border-[#dfe3dd] bg-white text-[#8a928c]"
                                                        )}
                                                        aria-hidden="true"
                                                      >
                                                        {step.done ? <UiIcon.Check className="h-3 w-3" /> : index + 1}
                                                      </span>
                                                      <div className={cx("min-w-0 flex-1", last ? "" : compact ? "pb-3" : "pb-4", current && "rounded-xl bg-[#f3f8f1] px-3.5 py-3 shadow-[inset_0_0_0_1px_#d6e8d6]", current && !last && "mb-4")}>
                                                        {compact ? (
                                                          <p className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] leading-[22px]">
                                                            <span className="font-semibold text-[#3b443e]">{step.title}</span>
                                                            <span className="min-w-0 text-[#7a827c]">{step.body}</span>
                                                            <span className="sr-only"> (done)</span>
                                                          </p>
                                                        ) : (
                                                          <>
                                                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1">
                                                              <span className={cx("text-[13.5px] font-semibold", current ? "text-[#1a201c]" : step.done ? "text-[#3b443e]" : "text-[#7a827c]")}>{step.title}</span>
                                                              {current ? <span className="rounded-full bg-[#1f2b24] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-white">Up next</span> : null}
                                                              <span className="sr-only">{step.done ? " (done)" : current ? " (next)" : ""}</span>
                                                            </div>
                                                            {step.amount ? (
                                                              <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
                                                                <span className="text-[22px] font-semibold leading-tight tabular-nums tracking-[-0.01em] text-[#1a201c]">{step.amount.value}</span>
                                                                <span className="text-[12.5px] text-[#4b544e]">{step.amount.caption}</span>
                                                              </p>
                                                            ) : null}
                                                            {step.stats ? (
                                                              <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Your reels">
                                                                {step.stats.map((stat) => (
                                                                  <li key={stat.label} className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold tabular-nums", stat.tone === "good" ? "bg-[#e3f1df] text-[#1f5131]" : stat.tone === "wait" ? "bg-[#fdf3dc] text-[#7a5410]" : stat.tone === "bad" ? "bg-[#fbe9e7] text-[#8e2b20]" : "bg-[#eef1ed] text-[#3b443e]")}>
                                                                    {stat.tone === "neutral" ? null : <span aria-hidden="true" className={cx("h-1.5 w-1.5 rounded-full", stat.tone === "good" ? "bg-[#2e7d4f]" : stat.tone === "wait" ? "bg-[#d29a2a]" : "bg-[#c4473a]")} />}
                                                                    {stat.label}
                                                                  </li>
                                                                ))}
                                                              </ul>
                                                            ) : null}
                                                            <p className={cx("text-[12.5px] leading-5", step.stats || step.amount ? "mt-1.5" : "mt-0.5", current ? "text-[#4b544e]" : "text-[#7a827c]")}>{step.body}</p>
                                                            {step.action || groupAction ? (
                                                              <div className={current ? "mt-3" : "mt-2"}>
                                                                {step.action ? (
                                                                  <button type="button" onClick={step.action.onClick} className={buttonClass}>
                                                                    {step.action.label} <UiIcon.ChevronRight className="h-3.5 w-3.5" />
                                                                  </button>
                                                                ) : null}
                                                                {groupAction ? (
                                                                  <a href={groupLink} target="_blank" rel="noreferrer noopener" className={buttonClass}>
                                                                    Open group <UiIcon.External />
                                                                  </a>
                                                                ) : null}
                                                              </div>
                                                            ) : null}
                                                          </>
                                                        )}
                                                      </div>
                                                    </li>
                                                  );
                                                })}
                                              </ol>
                                              {nextIndex === -1 ? (
                                                <p className="mt-4 flex items-start gap-2.5 rounded-xl bg-[#e9f4e6] px-3.5 py-3 text-[12.5px] leading-5 text-[#1f5131]">
                                                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#2e7d4f] text-white" aria-hidden="true"><UiIcon.Check className="h-3 w-3" /></span>
                                                  <span>
                                                    <span className="font-semibold">You&apos;re all set.</span>{" "}
                                                    {isContentPostingGig(selectedGig) ? `Keep posting: submit each new reel from ${strings.nav.accounts} and every approval adds to your earnings.` : "Every step is complete for this gig."}
                                                  </span>
                                                </p>
                                              ) : null}
                                            </section>

                                            {/* This gig at a glance: one card, the rate first, then the agreed details. Packed to the top, never stretched. */}
                                            <aside aria-label="This gig" className="border-t border-[#e3efe0] bg-[#fafbf9] p-4 sm:p-5 @2xl:border-l @2xl:border-t-0">
                                              <dl className="overflow-hidden rounded-xl bg-white text-[13px] shadow-[inset_0_0_0_1px_#e3efe0]">
                                                <div className="p-3.5">
                                                  <dt className="flex items-center gap-1.5 text-[11.5px] font-medium text-[#616a64]"><UiIcon.Wallet className="h-3.5 w-3.5 text-[#2e7d4f]" />Listed payout</dt>
                                                  <dd className="mt-1 text-[16px] text-[#1a201c]"><JobPayout gig={selectedGig} /></dd>
                                                </div>
                                                {([] as Array<[string, string]>)
                                                  .concat(proposal?.budget ? [["Your quote", proposal.budget]] : [])
                                                  .concat(proposal?.timeline ? [[proposalTimelineLabel, proposal.timeline]] : [])
                                                  .concat(isContentPostingGig(selectedGig) && linkedHandle ? [["Posting on", `@${linkedHandle}`]] : [])
                                                  .map(([label, value]) => (
                                                    <div key={label} className="flex items-baseline justify-between gap-3 border-t border-[#eef1ec] px-3.5 py-2.5">
                                                      <dt className="shrink-0 text-[12px] text-[#7a827c]">{label}</dt>
                                                      <dd className="min-w-0 break-words text-right font-semibold tabular-nums text-[#1a201c]">{value}</dd>
                                                    </div>
                                                  ))}
                                              </dl>
                                              {isContentPostingGig(selectedGig) && linkedHandle ? (
                                                <button type="button" onClick={() => navigateFromView("accounts")} className="mt-2.5 inline-flex min-h-9 items-center gap-1 rounded-md px-0.5 text-[12.5px] font-semibold text-[#2e7d4f] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[#2e7d4f]">
                                                  View account stats <UiIcon.ChevronRight className="h-3.5 w-3.5" />
                                                </button>
                                              ) : null}
                                            </aside>
                                          </div>
                                        </div>

                                        <div className="border-t border-[#e3efe0]">
                                          <GigBriefAssets key={String(selectedGig.id)} requirements={selectedGig.requirements} company={selectedGig.company} creatorName={profileDisplayName} gigId={String(selectedGig.id)} forReels={isContentPostingGig(selectedGig)} embedded />
                                        </div>

                                        {onboardingItems.length ? (
                                          <div className="border-t border-[#e3efe0] bg-white p-4 sm:p-5">
                                            <h4 className="text-[13px] font-semibold text-[#1a201c]">Onboarding instructions</h4>
                                            <ol className="mt-2 space-y-1.5">
                                              {onboardingItems.map((item, index) => (
                                                <li key={`${item}-${index}`} className="flex gap-2.5 text-[13px] leading-6 text-[#3b443e]">
                                                  <span className="mt-[3px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[#eef1ed] text-[10px] font-bold text-[#2b5d4a]">{index + 1}</span>
                                                  {item}
                                                </li>
                                              ))}
                                            </ol>
                                          </div>
                                        ) : null}

                                        <div className="flex flex-col gap-2 border-t border-[#e3efe0] bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                                          <p className="text-[12.5px] text-[#616a64]">
                                            {isContentPostingGig(selectedGig) ? "Track your reels and earnings in Linked." : isEmailCreatorGig(selectedGig) ? "Continue with your assigned emails and submission below." : "Track this gig and the hiring team's updates in Jobs."}
                                          </p>
                                          <div className="flex flex-col-reverse gap-2 min-[420px]:flex-row">
                                            <UiButton size="sm" className="w-full min-[420px]:w-auto" onClick={() => navigateFromView("messages")}>
                                              Messages
                                            </UiButton>
                                            {isWorkspaceGig(selectedGig) ? (
                                              <Link href="/workspace" className={buttonClassName("primary", "sm", "w-full min-[420px]:w-auto")}>Open workspace<UiIcon.ChevronRight className="h-3.5 w-3.5" /></Link>
                                            ) : (
                                              <UiButton variant="primary" size="sm" className="w-full min-[420px]:w-auto" onClick={() => {
                                                if (isContentPostingGig(selectedGig)) navigateFromView("accounts");
                                                else if (isEmailCreatorGig(selectedGig)) document.getElementById("gig-work")?.scrollIntoView({ behavior: "smooth", block: "start" });
                                                else navigateFromView("jobs");
                                              }}>
                                                {isContentPostingGig(selectedGig) ? "View reels & earnings" : isEmailCreatorGig(selectedGig) ? "Continue assignment" : "View in Jobs"}<UiIcon.ChevronRight className="h-3.5 w-3.5" />
                                              </UiButton>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })()
                                : null}

                              {!isDirectApplicationFlow && selectedGigApplication?.proposal && (selectedGigApplication.proposal.pitch || selectedGigApplication.proposal.timeline) ? (
                                <details
                                  className="group rounded-lg border border-[#ebedea] bg-white [&_summary::-webkit-details-marker]:hidden"
                                  open={proposalReceipt?.gigId === String(selectedGig.id) || undefined}
                                >
                                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-3.5 py-3 text-[13px] font-semibold text-[#1a201c] transition hover:bg-[#fafbf9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40">
                                    Your proposal
                                    <UiIcon.ChevronDown className="h-4 w-4 text-[#7a827c] transition-transform group-open:rotate-180" />
                                  </summary>
                                  <div className="space-y-3 border-t border-[#ebedea] px-3.5 py-3.5">
                                    <dl className="grid gap-3 text-[13px] sm:grid-cols-3">
                                      {[
                                        [proposalTimelineLabel, selectedGigApplication.proposal.timeline],
                                        [proposalBudgetLabel, selectedGigApplication.proposal.budget],
                                        ["Work sample", selectedGigApplication.proposal.portfolio],
                                      ]
                                        .filter(([, value]) => String(value ?? "").trim())
                                        .map(([label, value]) => (
                                          <div key={label} className="min-w-0">
                                            <dt className="text-[12px] text-[#616a64]">{label}</dt>
                                            <dd className="mt-0.5 break-words font-medium text-[#1a201c]">
                                              {label === "Work sample" && /^https?:\/\//i.test(String(value)) ? (
                                                <a href={String(value)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-[#2b5d4a] underline-offset-2 hover:underline">
                                                  Open link <UiIcon.External />
                                                </a>
                                              ) : (
                                                value
                                              )}
                                            </dd>
                                          </div>
                                        ))}
                                    </dl>
                                    {selectedGigApplication.proposal.pitch ? (
                                      <div>
                                        <div className="text-[12px] text-[#616a64]">Note</div>
                                        <p className="mt-0.5 whitespace-pre-line text-[13.5px] leading-6 text-[#1a201c]">{selectedGigApplication.proposal.pitch}</p>
                                      </div>
                                    ) : null}
                                  </div>
                                </details>
                              ) : null}

                              {recruiterNote || recruiterExplanation ? (
                                <div className="space-y-2.5">
                                  <h3 className="text-[13px] font-semibold text-[#1a201c]">From the hiring team</h3>
                                  {[
                                    { label: "Note", body: recruiterNote },
                                    { label: "Next steps", body: recruiterExplanation },
                                  ]
                                    .filter((message) => message.body)
                                    .map((message) => (
                                      <div key={message.label} className="flex gap-3 rounded-lg border border-[#ebedea] bg-white p-3.5">
                                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#eef1ed] text-[11px] font-bold text-[#2b5d4a]" aria-hidden="true">
                                          {getInitials(selectedGig.company)}
                                        </span>
                                        <div className="min-w-0">
                                          <div className="text-[12px] font-semibold text-[#616a64]">
                                            {selectedGig.company} · {message.label}
                                          </div>
                                          <p className="mt-0.5 whitespace-pre-line text-[13.5px] leading-6 text-[#1a201c]">{message.body}</p>
                                        </div>
                                      </div>
                                    ))}
                                </div>
                              ) : selectedGigReviewStatus === "Accepted" || needsAccountSetup ? null : (
                                <p className="rounded-lg border border-dashed border-[#dfe2de] px-3.5 py-3 text-[13px] text-[#616a64]">
                                  {isDirectApplicationFlow
                                    ? "No proposal was needed for this listing. Recruiters are reviewing your profile, availability and fit."
                                    : "No notes from the hiring team yet. You'll see them here as soon as they're posted."}
                                </p>
                              )}
                            </div>
                          ) : isDirectApplicationFlow ? (
                            /* ---------------- Quick apply ---------------- */
                            proposalDeskOpen ? (
                              <div className="space-y-4">
                                {limitNotice}
                                <div className="flex items-center gap-3 rounded-lg border border-[#ebedea] bg-[#fafbf9] p-3.5">
                                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1f2b24] text-[14px] font-semibold text-white" aria-hidden="true">
                                    {getInitials(profileDisplayName)}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <div className="text-[12px] text-[#616a64]">Applying as</div>
                                    <div className="truncate text-[14px] font-semibold text-[#1a201c]">{profileDisplayName}</div>
                                    <div className={cx("truncate text-[12.5px]", directApplySubmissionEmail ? "text-[#616a64]" : "text-[#b42318]")}>{directApplyContactValue}</div>
                                  </div>
                                  <StatusBadge
                                    status={directApplyContactStatus}
                                    tone={directApplySubmissionEmail ? "success" : directApplyContactLoading ? "neutral" : "critical"}
                                  />
                                </div>
                                {!directApplySubmissionEmail && !directApplyContactLoading ? (
                                  <p className="text-[12.5px] text-[#8e1f1a]">Add an email in your profile, then come back here to apply.</p>
                                ) : null}

                                <ol className="grid gap-2 sm:grid-cols-3">
                                  {[
                                    ["Confirm", "Accept the screening terms."],
                                    ["Review", "A recruiter checks your fit."],
                                    ["Decision", "The result posts here."],
                                  ].map(([title, body], index) => (
                                    <li key={title} className="flex gap-2.5 rounded-lg border border-[#ebedea] p-3">
                                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#eef1ed] text-[11px] font-bold text-[#2b5d4a]">{index + 1}</span>
                                      <span className="min-w-0">
                                        <span className="block text-[13px] font-semibold text-[#1a201c]">{title}</span>
                                        <span className="block text-[12px] leading-5 text-[#616a64]">{body}</span>
                                      </span>
                                    </li>
                                  ))}
                                </ol>

                                <div className="flex flex-col-reverse gap-2 border-t border-[#ebedea] pt-4 sm:flex-row sm:items-center sm:justify-between">
                                  <p className="text-[12.5px] text-[#616a64]">Only your profile is shared. Payout: <JobPayout gig={selectedGig} /></p>
                                  <div className="flex flex-col-reverse gap-2 sm:flex-row">
                                    <UiButton onClick={() => setProposalDeskOpen(false)} className="w-full sm:w-auto">
                                      Cancel
                                    </UiButton>
                                    <UiButton variant="primary" onClick={() => void openDashboardDirectApplyModal()} disabled={proposalSaving || !!detailLimitBlock} className="w-full sm:w-auto">
                                      {proposalSaving ? "Submitting…" : "Apply now"}
                                    </UiButton>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-3">
                                {limitNotice}
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                  <p className="text-[13.5px] text-[#3b443e]">
                                    {startsWorkDirectly ? "Apply once and you're approved instantly. No proposal or screening." : "Confirm once to enter recruiter screening. No proposal needed."}
                                  </p>
                                  <UiButton variant="primary" onClick={() => void openDashboardDirectApplyModal()} disabled={!!detailLimitBlock} className="w-full sm:w-auto">
                                    {detailLimitBlock ? primaryApplicationActionLabel : "Apply now"}
                                  </UiButton>
                                </div>
                              </div>
                            )
                          ) : proposalDeskOpen ? (
                            /* ---------------- Proposal form ---------------- */
                            <form
                              onSubmit={(event) => {
                                event.preventDefault();
                                void submitDashboardProposal();
                              }}
                              className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_260px] xl:items-start"
                            >
                              <div className="min-w-0 space-y-4">
                                {limitNotice}
                                {canReviseProposal ? (
                                  <div className="rounded-lg border border-[#f1dea6] bg-[#fffbeb] p-3.5">
                                    <div className="flex items-center gap-2 text-[13px] font-semibold text-[#6b4a05]">
                                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
                                        <path d="M10 3.5 17 16H3L10 3.5Z" strokeLinejoin="round" />
                                        <path d="M10 8.5v3.2M10 13.9v.1" strokeLinecap="round" />
                                      </svg>
                                      Address this feedback in your revision
                                    </div>
                                    {feedbackMessages.length ? (
                                      <ul className="mt-2 space-y-1.5">
                                        {feedbackMessages.map((message) => (
                                          <li key={message.label} className="text-[13px] leading-6 text-[#4a3a0c]">
                                            <span className="font-semibold">{message.label}:</span> <span className="whitespace-pre-line">{message.body}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    ) : (
                                      <p className="mt-1.5 text-[13px] leading-6 text-[#4a3a0c]">No specific notes were left. Sharpen your note, timeline and rate before resubmitting.</p>
                                    )}
                                  </div>
                                ) : null}

                                <label className="block">
                                  <span className="flex items-baseline justify-between gap-2">
                                    <span className="text-[13px] font-medium text-[#1a201c]">
                                      Proposal note <span className="text-[#b42318]" aria-hidden="true">*</span>
                                      {editedPill(pitchEdited)}
                                    </span>
                                    <span className="text-[11.5px] tabular-nums text-[#8a928c]" aria-live="polite">
                                      {pitchLength} characters
                                    </span>
                                  </span>
                                  <textarea
                                    value={proposalPitch}
                                    onChange={(event) => setProposalPitch(event.target.value)}
                                    required
                                    rows={7}
                                    placeholder="Your relevant experience, how you'd approach this gig, and why you're a strong fit."
                                    className={cx(fieldClass, "min-h-[168px] resize-y py-2.5 leading-6")}
                                  />
                                  <span className="mt-1 block text-[12px] text-[#7a827c]">Mention similar work and the results you got. 3–5 sentences is plenty.</span>
                                </label>

                                <div className={cx("grid gap-4", requiresBudget && "sm:grid-cols-2")}>
                                  <div className="min-w-0">
                                    <label className="block">
                                      <span className="text-[13px] font-medium text-[#1a201c]">
                                        {proposalTimelineLabel} <span className="text-[#b42318]" aria-hidden="true">*</span>
                                        {editedPill(timelineEdited)}
                                      </span>
                                      <input
                                        value={proposalTimeline}
                                        onChange={(event) => setProposalTimeline(event.target.value)}
                                        required
                                        placeholder="e.g. First draft in 3 days"
                                        className={cx(fieldClass, "h-10")}
                                      />
                                    </label>
                                    <div className="mt-2 flex flex-wrap gap-1.5" aria-label={`${proposalTimelineLabel} suggestions`}>
                                      {timelinePresets.map((preset) => (
                                        <button
                                          key={preset}
                                          type="button"
                                          onClick={() => setProposalTimeline(preset)}
                                          aria-pressed={proposalTimeline === preset}
                                          className={cx(
                                            "rounded-full border px-2.5 py-1 text-[12px] font-medium transition",
                                            proposalTimeline === preset ? "border-[#1f2b24] bg-[#1f2b24] text-white" : "border-[#e3e5e1] bg-white text-[#4b544e] hover:bg-[#f3f4f1]"
                                          )}
                                        >
                                          {preset}
                                        </button>
                                      ))}
                                    </div>
                                  </div>

                                  {requiresBudget ? (
                                    <div className="min-w-0">
                                      <label className="block">
                                        <span className="text-[13px] font-medium text-[#1a201c]">
                                          {proposalBudgetLabel} <span className="text-[#b42318]" aria-hidden="true">*</span>
                                          {editedPill(budgetEdited)}
                                        </span>
                                        <input
                                          value={proposalBudget}
                                          onChange={(event) => setProposalBudget(event.target.value)}
                                          required
                                          placeholder="e.g. ₹18,000 monthly or ₹600 per reel"
                                          className={cx(fieldClass, "h-10")}
                                        />
                                      </label>
                                      <button
                                        type="button"
                                        onClick={() => setProposalBudget(selectedGig.payout)}
                                        className="mt-2 rounded-full border border-[#e3e5e1] bg-white px-2.5 py-1 text-[12px] font-medium text-[#4b544e] transition hover:bg-[#f3f4f1]"
                                      >
                                        Use listed rate · {selectedGig.payout}
                                      </button>
                                    </div>
                                  ) : null}
                                </div>

                                <label className="block">
                                  <span className="text-[13px] font-medium text-[#1a201c]">
                                    Portfolio or work sample <span className="font-normal text-[#7a827c]">(optional)</span>
                                    {editedPill(portfolioEdited)}
                                  </span>
                                  <input
                                    value={proposalPortfolio}
                                    onChange={(event) => setProposalPortfolio(event.target.value)}
                                    inputMode="url"
                                    autoComplete="url"
                                    placeholder="https://… reel, portfolio or drive link"
                                    className={cx(fieldClass, "h-10")}
                                  />
                                </label>
                              </div>

                              {/* Readiness */}
                              <aside className="rounded-lg border border-[#ebedea] bg-[#fafbf9] p-3.5 xl:sticky xl:top-24">
                                <div className="flex items-center justify-between text-[12.5px]">
                                  <span className="font-semibold text-[#1a201c]">Ready to send</span>
                                  <span className="tabular-nums text-[#616a64]">
                                    {requiredDone}/{requirementsList.length}
                                  </span>
                                </div>
                                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e3efe2]" aria-hidden="true">
                                  <div className="h-full rounded-full bg-[#2e7d4f] transition-[width] duration-500" style={{ width: `${(requiredDone / requirementsList.length) * 100}%` }} />
                                </div>
                                <ul className="mt-3 space-y-1.5 text-[12.5px]">
                                  {requirementsList.map((item) => (
                                    <li key={item.label} className={cx("flex items-center gap-2", item.done ? "text-[#1a201c]" : "text-[#7a827c]")}>
                                      <span
                                        className={cx(
                                          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
                                          item.done ? "bg-[#2e7d4f] text-white" : "border-[1.5px] border-dashed border-[#a9b0aa]"
                                        )}
                                        aria-hidden="true"
                                      >
                                        {item.done ? <UiIcon.Check className="h-2.5 w-2.5" /> : null}
                                      </span>
                                      {item.label}
                                      <span className="sr-only">{item.done ? "done" : "missing"}</span>
                                    </li>
                                  ))}
                                  <li className={cx("flex items-center gap-2", proposalPortfolio.trim() ? "text-[#1a201c]" : "text-[#9aa29c]")}>
                                    <span
                                      className={cx(
                                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
                                        proposalPortfolio.trim() ? "bg-[#2e7d4f] text-white" : "border-[1.5px] border-dotted border-[#c5cac6]"
                                      )}
                                      aria-hidden="true"
                                    >
                                      {proposalPortfolio.trim() ? <UiIcon.Check className="h-2.5 w-2.5" /> : null}
                                    </span>
                                    Work sample (optional)
                                  </li>
                                </ul>
                                {previousProposal ? (
                                  <div className="mt-3 flex items-center justify-between rounded-md bg-white px-2.5 py-2 text-[12.5px] ring-1 ring-inset ring-[#ebedea]">
                                    <span className="text-[#616a64]">Changes since last version</span>
                                    <span className={cx("font-semibold tabular-nums", editedCount ? "text-[#1f4a73]" : "text-[#b26b00]")}>{editedCount}</span>
                                  </div>
                                ) : null}
                                <p className="mt-3 border-t border-[#ebedea] pt-3 text-[12px] leading-5 text-[#7a827c]">
                                  Replies and decisions from {selectedGig.company} appear on this page and in Messages.
                                </p>
                              </aside>

                              <div className="flex flex-col-reverse gap-2 border-t border-[#ebedea] pt-4 sm:flex-row sm:items-center sm:justify-end xl:col-span-2">
                                {previousProposal && editedCount === 0 ? (
                                  <p className="text-[12.5px] text-[#8a5a00] sm:mr-auto" role="status">
                                    You haven&apos;t changed anything since your last version.
                                  </p>
                                ) : null}
                                <UiButton onClick={() => setProposalDeskOpen(false)} className="w-full sm:w-auto">
                                  Cancel
                                </UiButton>
                                <UiButton type="submit" variant="primary" disabled={proposalSaving || !!detailLimitBlock} className="w-full sm:w-auto">
                                  {proposalSaving ? "Submitting…" : detailLimitBlock ? primaryApplicationActionLabel : canReviseProposal ? "Submit revision" : "Submit proposal"}
                                </UiButton>
                              </div>
                            </form>
                          ) : canReviseProposal ? (
                            /* ---------------- Revision requested ---------------- */
                            <div className="space-y-5">
                              <ol className="grid grid-cols-4 gap-1.5 sm:gap-2" aria-label="Proposal progress">
                                {[
                                  { label: "Submitted", short: "Sent", state: "done" },
                                  { label: "Reviewed", short: "Reviewed", state: "done" },
                                  { label: "Changes", short: "Changes", state: "attention" },
                                  { label: "Resubmit", short: "Resubmit", state: "todo" },
                                ].map((step) => (
                                  <li key={step.label} className="min-w-0">
                                    <div
                                      className={cx(
                                        "h-1.5 rounded-full",
                                        step.state === "done" && "bg-[#2e7d4f]",
                                        step.state === "attention" && "bg-[#d99a06]",
                                        step.state === "todo" && "bg-[#eaece8]"
                                      )}
                                    />
                                    <div
                                      className={cx(
                                        "mt-2 flex items-center gap-1 truncate text-[11.5px] font-semibold sm:text-[12.5px]",
                                        step.state === "todo" ? "text-[#9aa29c]" : step.state === "attention" ? "text-[#8a5a00]" : "text-[#1a201c]"
                                      )}
                                    >
                                      {step.state === "done" ? <UiIcon.Check className="hidden h-3.5 w-3.5 shrink-0 text-[#2e7d4f] sm:block" /> : null}
                                      {step.state === "attention" ? <span className="hidden h-2 w-2 shrink-0 animate-pulse rounded-full bg-[#d99a06] sm:block" aria-hidden="true" /> : null}
                                      <span className="truncate sm:hidden">{step.short}</span>
                                      <span className="hidden truncate sm:inline">{step.label}</span>
                                    </div>
                                  </li>
                                ))}
                              </ol>

                              <div className="space-y-2.5">
                                <h3 className="text-[13px] font-semibold text-[#1a201c]">What {selectedGig.company} asked for</h3>
                                {feedbackMessages.length ? (
                                  feedbackMessages.map((message) => (
                                    <div key={message.label} className="flex gap-3 rounded-lg border border-[#f1dea6] bg-[#fffbeb] p-3.5">
                                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-bold text-[#8a5a00] ring-1 ring-[#f1dea6]" aria-hidden="true">
                                        {getInitials(selectedGig.company)}
                                      </span>
                                      <div className="min-w-0">
                                        <div className="text-[12px] font-semibold text-[#8a5a00]">
                                          {selectedGig.company} · {message.label}
                                        </div>
                                        <p className="mt-0.5 whitespace-pre-line text-[13.5px] leading-6 text-[#1a201c]">{message.body}</p>
                                      </div>
                                    </div>
                                  ))
                                ) : (
                                  <p className="rounded-lg border border-dashed border-[#f1dea6] bg-[#fffbeb] px-3.5 py-3 text-[13px] text-[#4a3a0c]">
                                    No specific notes were left. Sharpen your note, timeline and rate, then resubmit.
                                  </p>
                                )}
                              </div>

                              {previousProposal && (previousProposal.timeline || previousProposal.budget) ? (
                                <dl className="grid grid-cols-2 divide-x divide-[#ebedea] overflow-hidden rounded-lg border border-[#ebedea] bg-[#fafbf9] text-[13px] sm:grid-cols-3">
                                  <div className="min-w-0 px-3.5 py-3">
                                    <dt className="text-[12px] text-[#616a64]">Last sent</dt>
                                    <dd className="mt-0.5 truncate font-semibold text-[#1a201c]">{proposalSubmittedAt ? formatDetailedDate(proposalSubmittedAt) : "—"}</dd>
                                  </div>
                                  <div className="min-w-0 px-3.5 py-3">
                                    <dt className="text-[12px] text-[#616a64]">{proposalTimelineLabel}</dt>
                                    <dd className="mt-0.5 truncate font-semibold text-[#1a201c]" title={previousProposal.timeline}>{previousProposal.timeline || "—"}</dd>
                                  </div>
                                  {requiresBudget ? (
                                    <div className="col-span-2 min-w-0 border-t border-[#ebedea] px-3.5 py-3 sm:col-span-1 sm:border-t-0">
                                      <dt className="text-[12px] text-[#616a64]">{proposalBudgetLabel}</dt>
                                      <dd className="mt-0.5 truncate font-semibold text-[#1a201c]" title={previousProposal.budget}>{previousProposal.budget || "—"}</dd>
                                    </div>
                                  ) : null}
                                </dl>
                              ) : null}

                              <div className="flex flex-col gap-3 border-t border-[#ebedea] pt-4 sm:flex-row sm:items-center sm:justify-between">
                                <p className="text-[12.5px] text-[#616a64]">Your previous answers are pre-filled, so you only need to change what was asked.</p>
                                <UiButton variant="primary" onClick={() => scrollToProposalDesk(true)} className="w-full sm:w-auto">
                                  Revise proposal
                                </UiButton>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <p className="text-[13.5px] text-[#3b443e]">Takes about 2 minutes: a short note, your timeline{requiresBudget ? " and rate" : ""}.</p>
                              <UiButton variant="primary" onClick={() => scrollToProposalDesk(true)} className="w-full sm:w-auto">
                                {canReviseProposal ? "Revise proposal" : "Write proposal"}
                              </UiButton>
                            </div>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </article>
                {selectedGigReviewStatus !== "Accepted" && startsWorkDirectly && hasWorkAssignment ? <GigBriefAssets key={String(selectedGig.id)} requirements={selectedGig.requirements} company={selectedGig.company} /> : null}
                {/* Email Creator gigs: show the work panel from the start, so creators see which of their work emails (and
                    inbox) the gig will use even before applying. */}
                {isEmailCreatorGig(selectedGig) && submissionWorkerId ? (
                  <GigWorkPanel
                    key={String(selectedGig.id)}
                    gigId={String(selectedGig.id)}
                    platform={selectedGig.platform}
                    workerId={submissionWorkerId}
                    canActivate={gigIsOpen}
                    applied={hasApplication || hasWorkAssignment}
                    onAssignmentUpdated={updateWorkAssignment}
                    onOpenWallet={() => navigateFromView("wallet")}
                  />
                ) : null}
              </DashboardReveal>

              <DashboardReveal delay={180} className="grid min-w-0 gap-4 md:grid-cols-2 lg:sticky lg:top-24 lg:grid-cols-1 lg:self-start">
                <article className="gig-detail-card hidden p-5 lg:block" aria-label="Payout and application">
                  <div className="text-[12px] font-medium text-[#616a64]">Payout</div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
                    <span className="text-[30px] font-semibold leading-none tracking-[-0.02em] text-[#1a201c]">{detailPayout.amount}</span>
                    <span className="text-[13.5px] text-[#616a64]">{detailPayout.unit || payoutLabel}</span>
                  </div>

                  {hasApplication ? (
                    <div className="mt-4 rounded-lg bg-[#fafbf9] px-3 py-2.5 ring-1 ring-inset ring-[#ebedea]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12.5px] font-medium text-[#616a64]">Your application</span>
                        <StatusBadge status={proposalStatusLabel} />
                      </div>
                      {proposalSubmittedAt ? <div className="mt-1 text-[12px] text-[#7a827c]">Sent {formatRelative(proposalSubmittedAt)}</div> : null}
                    </div>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => {
                      if (startsWorkDirectly && (hasApplication || hasWorkAssignment)) {
                        requestGigWorkStart(String(selectedGig.id));
                        return;
                      }
                      if (isDirectApplicationFlow && !applicationLocked) {
                        void openDashboardDirectApplyModal();
                        return;
                      }
                      scrollToProposalDesk(!applicationLocked);
                    }}
                    className="gig-detail-primary-button mt-4 w-full disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={!!detailLimitBlock}
                    title={detailLimitBlock ?? undefined}
                  >
                    {primaryApplicationActionLabel}
                  </button>
                  {detailLimitBlock ? <div className="mt-3">{limitNotice}</div> : null}

                  <ul className="mt-4 space-y-2 border-t border-[#ebedea] pt-4 text-[12.5px] text-[#616a64]">
                    <li className="flex items-start gap-2">
                      <UiIcon.Shield className="mt-0.5 h-4 w-4 shrink-0 text-[#2e7d4f]" />
                      {selectedGig.verified ? "Verified brand. Payouts go through your Reelencer wallet." : "Payouts go through your Reelencer wallet."}
                    </li>
                    <li className="flex items-start gap-2">
                      <UiIcon.Clipboard className="mt-0.5 h-4 w-4 shrink-0 text-[#8a928c]" />
                      {startsWorkDirectly
                        ? "Instant approval: start right after you apply."
                        : isDirectApplicationFlow
                          ? "Quick apply: one step, recruiter screening follows."
                          : "Send a short proposal with your rate and timeline."}
                    </li>
                  </ul>
                </article>

                <article className="gig-detail-card overflow-hidden" aria-labelledby="gig-brand-title">
                  <div className="flex items-center gap-3 p-4 sm:p-5">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#e3e5e1] bg-[#fafbf9] text-[16px] font-bold text-[#2b5d4a]" aria-hidden="true">
                      {getInitials(selectedGig.company)}
                    </span>
                    <div className="min-w-0">
                      <h2 id="gig-brand-title" className="flex items-center gap-1.5 truncate text-[14.5px] font-semibold text-[#1a201c]">
                        {selectedGig.company}
                        {selectedGig.verified ? <UiIcon.Check className="h-3.5 w-3.5 shrink-0 text-[#2e7d4f]" /> : null}
                      </h2>
                      <div className="truncate text-[12.5px] text-[#7a827c]">{selectedGig.verified ? "Verified brand" : "Active listing"} · {selectedGig.platform}</div>
                    </div>
                  </div>
                  <dl className="divide-y divide-[#f0f1ef] border-t border-[#ebedea] text-[13px]">
                    {[
                      ["Location", detailLocation],
                      ["Platform", selectedGig.platform],
                      ["Category", detailType],
                      ["Posted", detailDateLabel],
                    ].map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                        <dt className="text-[#616a64]">{label}</dt>
                        <dd className="min-w-0 truncate text-right font-medium text-[#1a201c]">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
              </DashboardReveal>
            </div>
          </section>
        );
      }

      const hasActiveFindFilters =
        searchText.trim() !== "" || activePlatformFilter !== "All" || activeLocationFilter !== "All regions";

      return (
        <section className="section-swipe-settle mx-auto w-full max-w-[1440px]">
          <div className="mx-auto w-full max-w-[1440px]">
            <PageHeader title={copy.title} description={copy.description} />
          </div>

          {/* Filters stay reachable while scrolling */}
          <div className="relative z-10 -mx-3.5 mt-4 border-b border-transparent bg-[#f3f4f1]/90 md:sticky px-3.5 py-3 backdrop-blur-md min-[380px]:-mx-4 min-[380px]:px-4 sm:-mx-5 sm:px-5 md:top-[68px] md:-mx-6 md:px-6 lg:-mx-7 lg:px-7 2xl:-mx-8 2xl:px-8">
            <div className="grid gap-2.5 md:grid-cols-[minmax(170px,220px)_minmax(0,1fr)]">
              <DashboardLocationFilter value={locationFilter} options={locationOptions} onChange={setLocationFilter} />
              <label className="relative block w-full" htmlFor="dashboard-search">
                <span className="sr-only">Search gigs</span>
                <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#6f7d74]" />
                <input
                  id="dashboard-search"
                  type="search"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Search gigs, brands, or platforms"
                  enterKeyHint="search"
                  className="h-11 w-full rounded-lg border border-[#d9ddd8] bg-white pl-11 pr-4 text-[16px] text-[#1a201c] shadow-[0_1px_2px_rgba(26,32,28,0.04)] outline-none transition placeholder:text-[#8a928c] focus:border-[#7fa58c] focus:ring-2 focus:ring-[#2e7d4f]/20 sm:text-[14px]"
                />
              </label>
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
              <div className="flex items-center justify-between gap-3 px-0.5 sm:order-2 sm:shrink-0 sm:justify-end">
                <div className="whitespace-nowrap text-[13px] font-semibold text-[#5f6f65]" aria-live="polite">
                  {gigsLoading && openGigs.length === 0 ? (
                    "Loading…"
                  ) : (
                    <>
                      <span className="tabular-nums text-[#20352c]">{filteredJobs.length}</span> {filteredJobs.length === 1 ? "gig" : "gigs"}{" "}
                      {hasActiveFindFilters ? "found" : "open"}
                    </>
                  )}
                </div>
                {hasActiveFindFilters ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchText("");
                      setPlatformFilter("All");
                      setLocationFilter("All regions");
                    }}
                    className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[13px] font-semibold text-[#41695b] transition hover:bg-[#eef3ea] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8db35a]"
                  >
                    <CloseIcon className="h-3.5 w-3.5" />
                    Clear
                  </button>
                ) : null}
              </div>

              <DashboardChipScroller
                label="Filter by platform"
                activeKey={activePlatformFilter}
                itemCount={platformOptions.length}
                className="-mx-3.5 flex min-w-0 flex-1 gap-2 overflow-x-auto scroll-px-3.5 px-3.5 py-1 min-[380px]:-mx-4 min-[380px]:scroll-px-4 min-[380px]:px-4 sm:order-1 sm:mx-0 sm:scroll-px-0 sm:px-0.5"
                onKeyDown={(event) => {
                  if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const index = platformOptions.indexOf(activePlatformFilter);
                  const last = platformOptions.length - 1;
                  const nextIndex =
                    event.key === "Home" ? 0 : event.key === "End" ? last : event.key === "ArrowRight" ? (index >= last ? 0 : index + 1) : index <= 0 ? last : index - 1;
                  const next = platformOptions[nextIndex];
                  if (!next) return;
                  setPlatformFilter(next);
                  window.requestAnimationFrame(() => document.getElementById(`platform-chip-${nextIndex}`)?.focus());
                }}
              >
                {platformOptions.map((platform, index) => {
                  const active = activePlatformFilter === platform;
                  const count = platformCounts.get(platform) ?? 0;
                  const empty = count === 0 && !active;
                  return (
                    <button
                      key={platform}
                      id={`platform-chip-${index}`}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      tabIndex={active ? 0 : -1}
                      onClick={() => setPlatformFilter(platform)}
                      className={cx(
                        "group inline-flex h-10 shrink-0 snap-start items-center gap-2 whitespace-nowrap rounded-full pl-3.5 pr-2 text-[13.5px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8db35a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f3f4f1] sm:h-9",
                        active
                          ? "bg-[#1f2b24] text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)]"
                          : "bg-white text-[#4f5f56] ring-1 ring-inset ring-[#e3eadf] hover:bg-[#f6f9f3] hover:text-[#20352c] hover:ring-[#cfdcc8]",
                        empty && "text-[#9aa59e]"
                      )}
                    >
                      {platform === "All" ? (
                        <span aria-hidden="true" className={cx("grid h-3.5 w-3.5 grid-cols-2 gap-[2px]", active ? "opacity-90" : "opacity-60")}>
                          {Array.from({ length: 4 }).map((_, dotIndex) => (
                            <span key={dotIndex} className="rounded-[1.5px] bg-current" />
                          ))}
                        </span>
                      ) : (
                        <span aria-hidden="true" className={cx("h-2.5 w-2.5 shrink-0 rounded-full", platformDotClass(platform), active && "ring-2 ring-white/70", empty && "opacity-40")} />
                      )}
                      <span>{platform === "All" ? "All platforms" : platform}</span>
                      <span
                        className={cx(
                          "min-w-[1.5rem] rounded-full px-1.5 py-0.5 text-center text-[11px] font-bold tabular-nums leading-4",
                          active ? "bg-white/20 text-white" : "bg-[#eef2ea] text-[#5f6f65] group-hover:bg-[#e6ede1]"
                        )}
                      >
                        {gigsLoading && openGigs.length === 0 ? "–" : count}
                      </span>
                    </button>
                  );
                })}
              </DashboardChipScroller>
            </div>
          </div>

          <div className="mt-3">
            <WeeklyApplicationsMeter
              quota={weeklyQuota}
              now={minuteNow}
              gigTitle={(gigId) => gigById.get(gigId)?.title ?? "Gig no longer listed"}
              onOpenGig={(gigId) => {
                const gig = gigById.get(gigId);
                if (gig) openGigDetail(gig, "details");
              }}
            />
          </div>

          <div className="mt-4">
            {gigsLoading && openGigs.length === 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5">
                {Array.from({ length: 6 }).map((_, index) => (
                  <GigBoardSkeletonCard key={index} />
                ))}
              </div>
            ) : filteredJobs.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-[#d9e3d6] bg-[#f8fbf5] px-5 py-12 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#edf5c7] text-[#41695b]">
                  <SearchIcon className="h-6 w-6" />
                </div>
                <div className="mt-4 text-[20px] font-semibold tracking-[-0.03em] text-[#20352c]">No matching gigs</div>
                <p className="mx-auto mt-2 max-w-[420px] text-[14px] leading-6 text-[#5f6f65]">Try another region, platform, or a broader search.</p>
                {hasActiveFindFilters ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchText("");
                      setPlatformFilter("All");
                      setLocationFilter("All regions");
                    }}
                    className="mt-5 inline-flex h-11 items-center rounded-full bg-[#41695b] px-5 text-[14px] font-semibold text-white"
                  >
                    Clear filters
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5">
                {filteredJobs.map((gig, index) => {
                  const featuredLabel = gig.browsePinLabel || (gig.browsePinned ? "Featured" : null);
                  const locationLabel = compactLocationLabel(gig.location);
                  const payoutMeta = gig.payoutType ?? gig.gigType ?? "per campaign";
                  const cardPayout = splitPayout(gig.payout);
                  const applicationMode = getDashboardApplicationMode(gig);
                  const isDirectApplicationFlow = applicationMode === "apply";
                  const cardApplication = applicationByGigId.get(String(gig.id)) ?? null;
                  const cardAssignment = assignmentByGigId.get(String(gig.id)) ?? null;
                  const cardReviewStatus = getProposalReviewStatus(cardApplication);
                  const cardHasApplication = !!cardApplication;
                  const cardHasAssignment = !!cardAssignment;
                  const cardOpenForApplications = String(gig.status ?? "").trim().toLowerCase() === "open" && !cardHasApplication && !cardHasAssignment;
                  // The weekly limit holds new applications until a slot opens; existing ones stay trackable.
                  const cardLimitBlocked = cardOpenForApplications && quotaBlocksGig(weeklyQuota, String(gig.id));
                  const cardCanApply = cardOpenForApplications && !cardLimitBlocked;
                  const cardWorkflowLabel = cardHasAssignment
                    ? isEmailCreatorGig(gig)
                      ? "In progress"
                      : "Assigned"
                    : cardLimitBlocked
                      ? "Weekly limit"
                    : isEmailCreatorGig(gig) && !cardHasApplication
                      ? "Instant approval"
                    : cardHasApplication
                      ? cardReviewStatus === "Accepted"
                        ? "Approved"
                        : cardReviewStatus === "Rejected"
                          ? isDirectApplicationFlow
                            ? "Closed"
                            : "Revision requested"
                          : isDirectApplicationFlow
                            ? "In screening"
                            : "In review"
                      : isDirectApplicationFlow
                        ? "Quick apply"
                        : "Proposal";
                  const cardWorkflowToneClass = cardHasAssignment
                    ? "bg-[#1f2b24] text-white"
                    : cardLimitBlocked
                      ? "bg-[#fff3dc] text-[#9a5b00]"
                    : cardReviewStatus === "Accepted"
                      ? "bg-[#e3f1df] text-[#1f5131]"
                      : cardReviewStatus === "Rejected"
                        ? "bg-[#fde4e1] text-[#8e1f1a]"
                        : cardHasApplication
                          ? "bg-[#e0ecf8] text-[#1f4a73]"
                          : "bg-[#f1f3f0] text-[#4b544e]";
                  const cardStartsWork = isEmailCreatorGig(gig);
                  const primaryCardActionLabel = cardLimitBlocked
                    ? `Opens in ${formatWait(weeklyQuota.nextSlotAt, minuteNow)}`
                    : cardStartsWork
                    ? cardHasAssignment || cardHasApplication
                      ? "Open your work"
                      : "Apply now"
                    : cardHasAssignment
                    ? "Open status"
                    : cardHasApplication
                      ? cardReviewStatus === "Rejected" && !isDirectApplicationFlow
                        ? "Revise proposal"
                        : "Track status"
                      : isDirectApplicationFlow
                        ? "Apply now"
                        : "Submit proposal";
                  const openPrimaryCardAction = () => {
                    if (cardStartsWork && (cardHasAssignment || cardHasApplication)) {
                      openGigDetail(gig, "details");
                      // The work panel picks this up once the gig page has loaded.
                      requestGigWorkStart(String(gig.id));
                      return;
                    }
                    if (cardHasAssignment || cardHasApplication) {
                      openGigDetail(gig, cardReviewStatus === "Rejected" && !isDirectApplicationFlow ? "apply" : "details");
                      return;
                    }
                    openGigApplication(gig);
                  };

                  const cardBrief =
                    getGigBrief(gig).split(/\n+/).map((line) => line.trim()).find(Boolean) ||
                    requirementTags(gig).join(" · ") ||
                    gigCardSummary(gig);
                  const cardTypeLabel = gig.gigType ? formatGigTypeLabel(gig.gigType) : "";
                  const cardSampleCount = parseGigSamples(gig.requirements).length;
                  const showTypeTag = !!cardTypeLabel && cardTypeLabel.toLowerCase() !== String(featuredLabel ?? "").toLowerCase();

                  return (
                    <article
                      key={gig.id}
                      className={cx(
                        "dashboard-reveal group relative flex h-full min-w-0 flex-col overflow-hidden rounded-xl border bg-white shadow-[0_1px_0_rgba(26,32,28,0.04),0_1px_2px_rgba(26,32,28,0.06)] transition duration-200 hover:border-[#cfd5cf] hover:shadow-[0_6px_18px_-8px_rgba(26,32,28,0.2)]",
                        featuredLabel ? "border-[#b9d5c0]" : "border-[#e3e5e1]"
                      )}
                      style={dashboardDelayStyle(160 + Math.min(index, 8) * 45)}
                    >
                      {featuredLabel ? (
                        <>
                          <span className="absolute inset-x-0 top-0 h-[3px] bg-[#2e7d4f]" aria-hidden />
                          <span className="absolute right-4 top-0 rounded-b-[6px] bg-[#e3f1df] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#1f5131] sm:right-5">
                            ★ {featuredLabel}
                          </span>
                        </>
                      ) : null}

                      <div className="flex flex-1 flex-col p-4 pt-6 sm:p-5 sm:pt-7">
                        {/* Header: brand + one status */}
                        <div className="flex items-center gap-3">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#e3e5e1] bg-[#fafbf9] text-[13px] font-bold text-[#2b5d4a]">
                            {getInitials(gig.company)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-[14px] font-semibold text-[#20352c]">{gig.company}</span>
                              {gig.verified ? <CheckIcon className="h-3.5 w-3.5 shrink-0 text-[#4c8a2f]" /> : null}
                            </div>
                            <div className="truncate text-[12px] text-[#6f7d74]">
                              {gig.platform}
                              {locationLabel !== "Remote" ? ` · ${locationLabel}` : ""}
                            </div>
                          </div>
                          <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-semibold", cardWorkflowToneClass)}>{cardWorkflowLabel}</span>
                        </div>

                        {/* Body: fixed two-line title and brief so every card lines up */}
                        <h3
                          className="mt-4 line-clamp-2 text-[17px] sm:min-h-[2.7em] font-semibold leading-[1.35] tracking-[-0.02em] text-[#20352c] sm:text-[18px]"
                          title={gig.title}
                        >
                          {gig.title}
                        </h3>
                        <p className="mt-1.5 line-clamp-2 text-[14px] sm:min-h-[3em] leading-[1.5] text-[#5f6f65]">{cardBrief}</p>
                      </div>

                      {/* Footer: payout, details, actions */}
                      <div className="mt-auto border-t border-[#ebedea] bg-[#fafbf9] px-4 pb-4 pt-3.5 sm:px-5 sm:pb-5">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#7a877f]">Payout</div>
                        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
                          <span className="whitespace-nowrap text-[20px] font-bold leading-tight tracking-[-0.03em] text-[#20352c]">{cardPayout.amount}</span>
                          <span className="whitespace-nowrap text-[12px] font-medium text-[#5f6f65]">{cardPayout.unit || payoutMeta}</span>
                        </div>
                        <div className="mt-2 flex min-h-[22px] min-w-0 items-center gap-2 text-[12px] text-[#5f6f65]">
                          {gig.workload ? (
                            <span className="flex min-w-0 items-center gap-1.5">
                              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                                <circle cx="12" cy="12" r="8" />
                                <path strokeLinecap="round" d="M12 8v4l2.5 2" />
                              </svg>
                              <span className="truncate">{gig.workload}</span>
                            </span>
                          ) : null}
                          <span className="ml-auto flex shrink-0 items-center gap-1.5">
                            {cardSampleCount ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[#e3f1df] px-2 py-0.5 text-[11px] font-semibold text-[#1f5131]" title="This gig has sample videos">
                                <svg viewBox="0 0 24 24" fill="currentColor" className="h-2.5 w-2.5" aria-hidden>
                                  <path d="M8 5.6v12.8a1 1 0 0 0 1.53.85l10.2-6.4a1 1 0 0 0 0-1.7L9.53 4.75A1 1 0 0 0 8 5.6Z" />
                                </svg>
                                {cardSampleCount} {cardSampleCount === 1 ? "sample" : "samples"}
                              </span>
                            ) : null}
                            {showTypeTag ? (
                              <span className="rounded-full bg-[#f0f4ec] px-2.5 py-0.5 text-[11px] font-semibold text-[#4d5f55]">{cardTypeLabel}</span>
                            ) : null}
                          </span>
                        </div>

                        <div className="mt-3.5 grid grid-cols-[auto_minmax(0,1fr)] gap-2">
                          <button
                            type="button"
                            onClick={() => openGigDetail(gig, "details")}
                            className="inline-flex h-10 items-center justify-center rounded-lg border border-[#d9ddd8] bg-white px-3.5 text-[13px] font-semibold text-[#1a201c] shadow-[0_1px_2px_rgba(26,32,28,0.06)] transition hover:bg-[#f7f8f6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40"
                          >
                            Details
                          </button>
                          <button
                            type="button"
                            onClick={openPrimaryCardAction}
                            disabled={!cardCanApply && !cardHasApplication && !cardHasAssignment}
                            title={cardLimitBlocked ? quotaLimitMessage(weeklyQuota, { now: minuteNow }) : undefined}
                            className={cx(
                              "inline-flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40 disabled:cursor-not-allowed",
                              cardCanApply
                                ? "bg-[#1f2b24] text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] hover:bg-[#2b3a31]"
                                : cardHasApplication || cardHasAssignment
                                  ? "border border-[#d9ddd8] bg-white text-[#1a201c] hover:bg-[#f7f8f6]"
                                  : "bg-[#eef0ed] text-[#8a928c]"
                            )}
                          >
                            {cardLimitBlocked ? (
                              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                <circle cx="12" cy="13" r="8" />
                                <path d="M12 9v4l2.5 2" />
                              </svg>
                            ) : null}
                            <span className="truncate">{primaryCardActionLabel}</span>
                            {cardLimitBlocked ? <span className="sr-only">. {quotaLimitMessage(weeklyQuota, { now: minuteNow })}</span> : <ArrowRightIcon className="h-4 w-4 shrink-0" />}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      );
    }

    if (currentSection === "accounts") {
      return (
        <section className="section-swipe-settle mx-auto w-full max-w-[1200px]">
          <DashboardReveal delay={40}>
            <PageHeader title={copy.title} description={copy.description} />
          </DashboardReveal>
          <DashboardReveal delay={90} className="mt-5">
            <SocialAccountsView state={socialAccounts} userId={profileUserId} onFindGigs={() => navigateFromView("find")} />
          </DashboardReveal>
        </section>
      );
    }

    if (currentSection === "messages") {
      const groupedThreads = filteredInboxThreads.reduce<Array<{ label: string; items: DashboardMessage[] }>>((groups, thread) => {
        const label = inboxDateGroup(thread);
        const last = groups[groups.length - 1];
        if (last && last.label === label) last.items.push(thread);
        else groups.push({ label, items: [thread] });
        return groups;
      }, []);
      const reader = inboxSelectedThread;
      const prevThread = inboxSelectedIndex > 0 ? filteredInboxThreads[inboxSelectedIndex - 1] : null;
      const nextThread = inboxSelectedIndex >= 0 ? filteredInboxThreads[inboxSelectedIndex + 1] ?? null : null;
      const iconButton =
        "inline-flex h-9 w-9 items-center justify-center rounded-[10px] text-[#5f6f65] transition hover:bg-[#f1f4ee] hover:text-[#20352c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8db35a] disabled:pointer-events-none disabled:opacity-35";

      return (
        <section className="section-swipe-settle mx-auto w-full max-w-[1440px]">
          <DashboardReveal delay={40} className={cx(inboxReaderOpen && "hidden lg:block")}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <PageHeader title={copy.title} description={copy.description} />
              <div className="hidden shrink-0 items-center gap-2 text-[12px] text-[#7a877f] xl:flex">
                <kbd className="rounded-md border border-[#dfe5db] bg-white px-1.5 py-0.5 font-mono text-[11px] text-[#4f5f56]">j</kbd>
                <kbd className="rounded-md border border-[#dfe5db] bg-white px-1.5 py-0.5 font-mono text-[11px] text-[#4f5f56]">k</kbd>
                <span>Browse messages</span>
                <kbd className="ml-2 rounded-md border border-[#dfe5db] bg-white px-1.5 py-0.5 font-mono text-[11px] text-[#4f5f56]">/</kbd>
                <span>Search</span>
              </div>
            </div>
          </DashboardReveal>

          <DashboardReveal delay={110} className="mt-5 sm:mt-7">
            <div className="overflow-clip rounded-xl border border-[#e3e5e1] bg-white shadow-[0_1px_0_rgba(26,32,28,0.04),0_1px_2px_rgba(26,32,28,0.06)] lg:grid lg:overflow-hidden lg:h-[calc(100dvh-240px)] lg:min-h-[620px] lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[400px_minmax(0,1fr)]">
              {/* List pane */}
              <div className={cx("min-w-0 flex-col border-[#e8ede5] lg:flex lg:min-h-0 lg:border-r", inboxReaderOpen ? "hidden" : "flex")}>
                <div className="sticky top-[60px] z-10 border-b border-[#e8ede5] bg-white/95 px-3 pb-3 pt-3 backdrop-blur sm:px-4 sm:pt-4 md:top-[68px] lg:top-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-baseline gap-2">
                      <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-[#20352c]">Inbox</h2>
                      <span className="text-[13px] text-[#7a877f]">{unreadCount > 0 ? `${unreadCount} unread` : "No unread"}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => updateThreadReadState(messageThreads.filter((thread) => thread.unread), true)}
                      disabled={unreadCount === 0}
                      className="inline-flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-[12px] font-semibold text-[#41695b] transition hover:bg-[#f1f4ee] disabled:pointer-events-none disabled:opacity-40"
                    >
                      <CheckIcon className="h-3.5 w-3.5" />
                      Mark all as read
                    </button>
                  </div>

                  <label className="relative mt-3 block">
                    <span className="sr-only">Search messages</span>
                    <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a968e]" />
                    <input
                      ref={inboxSearchRef}
                      type="search"
                      value={inboxQuery}
                      onChange={(event) => setInboxQuery(event.target.value)}
                      placeholder="Search messages"
                      className="h-10 w-full rounded-[12px] border border-[#e3e9df] bg-[#f7f9f5] pl-9 pr-10 text-[14px] text-[#20352c] outline-none transition placeholder:text-[#8a968e] focus:border-[#b9cfa8] focus:bg-white focus:ring-4 focus:ring-[#8db35a]/15"
                    />
                    {!inboxQuery && (
                      <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-[#dfe5db] bg-white px-1.5 font-mono text-[11px] text-[#8a968e] sm:block">/</kbd>
                    )}
                  </label>

                  <div className="-mx-3 mt-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5 [scrollbar-width:none] sm:-mx-4 sm:px-4 [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Filter messages">
                    {INBOX_FILTERS.map((filter) => {
                      const active = inboxFilter === filter.id;
                      const count = inboxFilterCounts[filter.id];
                      return (
                        <button
                          key={filter.id}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          onClick={() => setInboxFilter(filter.id)}
                          className={cx(
                            "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition",
                            active ? "border-[#1f2b24] bg-[#1f2b24] text-white" : "border-[#e3e9df] bg-white text-[#4f5f56] hover:bg-[#f4f7f1]"
                          )}
                        >
                          {filter.label}
                          {count > 0 && (
                            <span className={cx("rounded-full px-1.5 text-[10px] leading-4", active ? "bg-white/20 text-white" : "bg-[#eef2ea] text-[#5f6f65]")}>
                              {count}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" role="listbox" aria-label="Messages">
                  {groupedThreads.length === 0 ? (
                    <div className="flex flex-col items-center px-6 py-16 text-center">
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#f1f4ee] text-[#7a877f]">
                        <SearchIcon className="h-5 w-5" />
                      </span>
                      <div className="mt-3 text-[15px] font-semibold text-[#20352c]">
                        {inboxQuery ? "No matching messages" : inboxFilter === "unread" ? "You're all caught up" : inboxFilter === "starred" ? "No starred messages" : "No updates yet"}
                      </div>
                      <p className="mt-1 text-[13px] text-[#7a877f]">
                        {inboxQuery ? "Try another keyword or view all messages." : inboxFilter === "unread" ? "You've read all your messages. New updates will appear here." : inboxFilter === "starred" ? "Star a message to find it easily later." : "Updates will appear here when there's new activity."}
                      </p>
                      {(inboxQuery || inboxFilter !== "all") && (
                        <button
                          type="button"
                          onClick={() => {
                            setInboxQuery("");
                            setInboxFilter("all");
                          }}
                          className="mt-4 rounded-[10px] border border-[#e3e9df] px-3.5 py-2 text-[13px] font-semibold text-[#41695b] transition hover:bg-[#f4f7f1]"
                        >
                          Show all messages
                        </button>
                      )}
                    </div>
                  ) : (
                    groupedThreads.map((group) => (
                      <div key={group.label}>
                        <div className="sticky top-0 z-[1] border-b border-[#f0f3ee] bg-[#fafbf9]/95 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8a968e] backdrop-blur">
                          {group.label}
                        </div>
                        {group.items.map((thread) => {
                          const selected = reader?.id === thread.id;
                          return (
                            <button
                              key={thread.id}
                              id={`inbox-row-${thread.id}`}
                              type="button"
                              role="option"
                              aria-selected={selected}
                              onClick={() => openInboxThread(thread)}
                              className={cx(
                                "group relative flex w-full min-w-0 items-start gap-3 border-b border-[#f0f3ee] px-4 py-3.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#8db35a]",
                                selected ? "bg-[#f4f8ef]" : thread.unread ? "bg-white hover:bg-[#f8faf6]" : "bg-[#fcfdfb] hover:bg-[#f8faf6]"
                              )}
                            >
                              <span className={cx("absolute inset-y-0 left-0 w-[3px] transition", selected ? "bg-[#41695b]" : "bg-transparent")} />
                              <span className={cx("relative mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-bold", inboxAvatarClasses(thread.tone))}>
                                {inboxSenderInitials(thread.meta)}
                                {thread.unread && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white bg-[#c2410c]" aria-label="Unread" />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-baseline justify-between gap-2">
                                  <span className={cx("truncate text-[14px]", thread.unread ? "font-semibold text-[#1a2d24]" : "font-medium text-[#4f5f56]")}>{thread.meta}</span>
                                  <span className={cx("flex shrink-0 items-center gap-1 text-[12px]", thread.unread ? "font-semibold text-[#41695b]" : "text-[#8a968e]")}>
                                    {starredThreadSet.has(thread.id) && <StarIcon filled className="h-3.5 w-3.5 text-[#d79a12]" aria-label="Starred" />}
                                    {inboxListTime(thread.timestamp)}
                                  </span>
                                </span>
                                <span className={cx("mt-0.5 block truncate text-[14px]", thread.unread ? "font-semibold text-[#20352c]" : "text-[#34483f]")}>{thread.title}</span>
                                <span className="mt-0.5 flex items-center gap-2">
                                  <span className="min-w-0 flex-1 truncate text-[13px] text-[#7a877f]">{thread.preview}</span>
                                  <span className="hidden shrink-0 rounded-md bg-[#f1f4ee] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#6f7d74] sm:inline">
                                    {inboxCategoryLabel(thread)}
                                  </span>
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Reading pane */}
              <div
                id="message-detail"
                className={cx("min-w-0 flex-col bg-white lg:flex lg:min-h-0", inboxReaderOpen ? "flex" : "hidden")}
              >
                {reader ? (() => {
                  const readerStatus = inboxThreadStatus(reader);
                  const readerIsWelcome = reader.id === "starter-thread";
                  const readerSteps = inboxProgressSteps(reader);
                  const readerStarred = starredThreadSet.has(reader.id);
                  const relatedThreads = messageThreads.filter((thread) => thread.meta === reader.meta && thread.id !== reader.id).slice(0, 3);
                  const firstName = profileName.trim().split(/\s+/)[0] || "there";
                  const primaryActionClass =
                    "inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#1f2b24] px-5 py-3 text-[14px] font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition hover:bg-[#2b3a31] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8db35a] focus-visible:ring-offset-2 sm:w-auto";

                  return (
                    <>
                      <div className="sticky top-[60px] z-10 flex items-center justify-between gap-2 border-b border-[#e8ede5] bg-white/95 px-2 py-1.5 backdrop-blur sm:px-4 md:top-[68px] lg:top-0">
                        <div className="flex items-center gap-0.5">
                          <button type="button" onClick={() => setInboxReaderOpen(false)} className={cx(iconButton, "lg:hidden")} aria-label="Back to inbox" title="Back to inbox (u)">
                            <ArrowRightIcon className="h-[18px] w-[18px] rotate-180" />
                          </button>
                          <span className="mx-1 h-5 w-px bg-[#e8ede5] lg:hidden" />
                          <button
                            type="button"
                            onClick={() => toggleThreadStar(reader)}
                            className={cx(iconButton, readerStarred && "text-[#d79a12] hover:text-[#b8820c]")}
                            aria-pressed={readerStarred}
                            aria-label={readerStarred ? "Remove star" : "Star message"}
                            title={readerStarred ? "Remove star (s)" : "Star message (s)"}
                          >
                            <StarIcon filled={readerStarred} className="h-[18px] w-[18px]" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              updateThreadReadState([reader], false);
                              setInboxReaderOpen(false);
                            }}
                            className={iconButton}
                            disabled={!reader.important || reader.unread}
                            aria-label="Mark as unread"
                            title="Mark as unread"
                          >
                            <MessagesIcon className="h-[18px] w-[18px]" />
                          </button>
                        </div>
                        <div className="flex items-center gap-0.5 text-[12px] text-[#7a877f]">
                          <span className="mr-1.5 tabular-nums">
                            {inboxSelectedIndex + 1} of {filteredInboxThreads.length}
                          </span>
                          <button type="button" className={iconButton} disabled={!prevThread} onClick={() => prevThread && openInboxThread(prevThread)} aria-label="Previous message" title="Previous message (k)">
                            <ChevronDownIcon className="h-[18px] w-[18px] rotate-90" />
                          </button>
                          <button type="button" className={iconButton} disabled={!nextThread} onClick={() => nextThread && openInboxThread(nextThread)} aria-label="Next message" title="Next message (j)">
                            <ChevronDownIcon className="h-[18px] w-[18px] -rotate-90" />
                          </button>
                        </div>
                      </div>

                      <div key={reader.id} className="section-swipe-settle min-h-0 flex-1 overflow-y-auto">
                        <div className="px-4 pb-8 pt-5 sm:px-8 sm:pt-7">
                          {/* Subject */}
                          <div className="flex items-start gap-3">
                            <h2 className="min-w-0 flex-1 break-words text-[20px] font-semibold leading-snug tracking-[-0.02em] text-[#1a2d24] sm:text-[24px]">
                              {reader.detailTitle}
                              <span className={cx("ml-2 inline-flex translate-y-[-2px] rounded-md px-1.5 py-0.5 align-middle text-[11px] font-semibold", badgeToneClasses(reader.tone))}>
                                {inboxCategoryLabel(reader)}
                              </span>
                            </h2>
                          </div>

                          {/* Sender */}
                          <div className="mt-5 flex items-start gap-3">
                            <span
                              aria-hidden="true"
                              className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-bold sm:h-11 sm:w-11", inboxAvatarClasses(reader.tone))}
                            >
                              {inboxSenderInitials(reader.meta)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                                <div className="min-w-0 truncate text-[14px]">
                                  <span className="font-semibold text-[#20352c]">{reader.meta}</span>
                                  {reader.meta !== "Reelencer" && <span className="text-[#8a968e]"> via Reelencer</span>}
                                </div>
                                {reader.timestamp && (
                                  <time dateTime={new Date(safeTime(reader.timestamp)).toISOString()} className="shrink-0 text-[12px] text-[#7a877f]">
                                    {inboxReaderTime(reader.timestamp)}
                                  </time>
                                )}
                              </div>
                              <div ref={inboxDetailsRef} className="relative mt-0.5">
                                <button
                                  type="button"
                                  onClick={() => setInboxDetailsOpen((open) => !open)}
                                  aria-expanded={inboxDetailsOpen}
                                  aria-controls="inbox-message-details"
                                  aria-label={inboxDetailsOpen ? "Hide message details" : "Show message details"}
                                  className="inline-flex items-center gap-0.5 rounded-md text-[12px] text-[#7a877f] transition hover:text-[#20352c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8db35a]"
                                >
                                  To you
                                  <ChevronDownIcon className={cx("h-3.5 w-3.5 transition-transform", inboxDetailsOpen && "rotate-180")} />
                                </button>
                                {inboxDetailsOpen && (
                                  <div
                                    id="inbox-message-details"
                                    role="dialog"
                                    aria-label="Message details"
                                    className="absolute left-0 top-full z-20 mt-1.5 w-[min(420px,calc(100vw-5.5rem))] rounded-[12px] border border-[#e3e9df] bg-white p-3.5 text-[12px] shadow-[0_18px_40px_-16px_rgba(34,45,37,0.35)]"
                                  >
                                    <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2">
                                      <dt className="text-right text-[#8a968e]">From</dt>
                                      <dd className="min-w-0 break-words text-[#34483f]">
                                        <span className="font-semibold text-[#20352c]">{reader.meta}</span>{reader.meta !== "Reelencer" ? " via Reelencer" : ""}
                                      </dd>
                                      <dt className="text-right text-[#8a968e]">To</dt>
                                      <dd className="min-w-0 break-words text-[#34483f]">
                                        {profileName}
                                        {workerId ? <span className="text-[#8a968e]"> · {workerId}</span> : null}
                                      </dd>
                                      {reader.timestamp && <>
                                        <dt className="text-right text-[#8a968e]">Updated</dt>
                                        <dd className="min-w-0 break-words text-[#34483f]">{inboxFullTimestamp(reader.timestamp)}</dd>
                                      </>}
                                      <dt className="text-right text-[#8a968e]">Category</dt>
                                      <dd className="min-w-0 text-[#34483f]">{inboxCategoryLabel(reader)}</dd>
                                      {!readerIsWelcome && <>
                                        <dt className="text-right text-[#8a968e]">Reference</dt>
                                        <dd className="flex min-w-0 items-center gap-2">
                                          <span className="min-w-0 break-all font-mono text-[11.5px] text-[#34483f]">{inboxReference(reader)}</span>
                                          <button
                                            type="button"
                                            onClick={() => copyInboxReference(inboxReference(reader))}
                                            className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-[#41695b] transition hover:bg-[#f1f4ee]"
                                          >
                                            {inboxReferenceCopied ? "Copied" : "Copy reference"}
                                          </button>
                                        </dd>
                                      </>}
                                    </dl>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Email body */}
                          <div className="mt-6 sm:pl-14">
                            <div className="max-w-[680px] overflow-hidden rounded-[18px] border border-[#e8ede5] bg-white">
                              <div className="flex items-center justify-between gap-3 border-b border-[#eef2eb] bg-[linear-gradient(180deg,#f8faf6,#ffffff)] px-5 py-3.5 sm:px-7">
                                <span className="text-[13px] font-bold tracking-[-0.01em] text-[#20352c]">Reelencer</span>
                                {!readerIsWelcome && <span className={cx("rounded-full px-2.5 py-1 text-[11px] font-semibold", inboxStatusPillClasses(readerStatus))}>{readerStatus}</span>}
                              </div>

                              <div className="px-5 py-6 sm:px-7 sm:py-7">
                                <p className="text-[15px] text-[#20352c]">Hi {firstName},</p>
                                <p className="mt-3 break-words text-[15px] leading-7 text-[#34483f] [overflow-wrap:anywhere]">{reader.detailBody}</p>

                                {readerSteps.length > 0 && (
                                  <ol className="mt-6 grid grid-cols-3 gap-2" aria-label="Progress">
                                    {readerSteps.map((step) => (
                                      <li key={step.label} className="min-w-0">
                                        <div
                                          className={cx(
                                            "h-1.5 rounded-full",
                                            step.state === "done" && "bg-[#5d9b6f]",
                                            step.state === "current" && "bg-[linear-gradient(90deg,#5d9b6f,#d5e8d9)]",
                                            step.state === "failed" && "bg-[#e7a19a]",
                                            step.state === "todo" && "bg-[#eaefe7]"
                                          )}
                                        />
                                        <div
                                          className={cx(
                                            "mt-2 flex items-start gap-1.5 text-[12px] font-semibold",
                                            step.state === "todo" ? "text-[#9aa59e]" : step.state === "failed" ? "text-[#b42318]" : "text-[#20352c]"
                                          )}
                                        >
                                          {step.state === "done" && <CheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#5d9b6f]" />}
                                          {step.state === "current" && <span className="mt-1 h-2 w-2 shrink-0 animate-pulse rounded-full bg-[#5d9b6f]" />}
                                          <span className="min-w-0 break-words leading-4">{step.label}</span>
                                        </div>
                                      </li>
                                    ))}
                                  </ol>
                                )}

                                {!readerIsWelcome && <dl className="mt-6 divide-y divide-[#eef2eb] rounded-[14px] border border-[#eef2eb] bg-[#fafbf9] text-[13px]">
                                  {[
                                    { label: "Status", value: <span className={cx("rounded-full px-2 py-0.5 text-[12px] font-semibold", inboxStatusPillClasses(readerStatus))}>{readerStatus}</span> },
                                    ...(reader.timestamp
                                      ? [
                                          {
                                            label: "Updated",
                                            value: new Date(safeTime(reader.timestamp)).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }),
                                          },
                                        ]
                                      : []),
                                    { label: "Reference", value: <span className="font-mono text-[12px]" title={inboxReference(reader)}>{inboxReference(reader)}</span> },
                                  ].map((row) => (
                                    <div key={row.label} className="flex items-center justify-between gap-4 px-4 py-2.5">
                                      <dt className="text-[#7a877f]">{row.label}</dt>
                                      <dd className="min-w-0 truncate text-right font-medium text-[#20352c]">{row.value}</dd>
                                    </div>
                                  ))}
                                </dl>}

                                <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:items-center">
                                  {reader.href ? (
                                    <Link href={reader.href} className={primaryActionClass}>
                                      <span>{reader.actionLabel}</span>
                                      <ArrowRightIcon className="h-[18px] w-[18px]" />
                                    </Link>
                                  ) : (
                                    <button type="button" onClick={() => startTransition(() => setCurrentSection(reader.section))} className={primaryActionClass}>
                                      <span>{reader.actionLabel}</span>
                                      <ArrowRightIcon className="h-[18px] w-[18px]" />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => startTransition(() => setCurrentSection("dashboard"))}
                                    className="inline-flex w-full items-center justify-center rounded-[12px] px-4 py-3 text-[14px] font-semibold text-[#41695b] transition hover:bg-[#f4f7f1] sm:w-auto"
                                  >
                                    View dashboard
                                  </button>
                                </div>

                                <p className="mt-7 text-[14px] leading-6 text-[#5f6f65]">
                                  Thanks,
                                  <br />
                                  <span className="font-semibold text-[#20352c]">The Reelencer team</span>
                                </p>
                              </div>

                              <div className="border-t border-[#eef2eb] bg-[#fafbf9] px-5 py-3 text-[11px] leading-5 text-[#8a968e] sm:px-7">
                                {readerIsWelcome ? "Your creator updates, all in one place." : "This update was sent automatically by Reelencer."}
                              </div>
                            </div>

                            {relatedThreads.length > 0 && (
                              <div className="mt-6 max-w-[680px]">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8a968e]">More from {reader.meta}</div>
                                <div className="mt-2 divide-y divide-[#f0f3ee] overflow-hidden rounded-[14px] border border-[#e8ede5]">
                                  {relatedThreads.map((thread) => (
                                    <button
                                      key={thread.id}
                                      type="button"
                                      onClick={() => openInboxThread(thread)}
                                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[#f8faf6]"
                                    >
                                      <span className={cx("h-2 w-2 shrink-0 rounded-full", thread.unread ? "bg-[#c2410c]" : "bg-transparent")} />
                                      <span className={cx("min-w-0 flex-1 truncate text-[13px]", thread.unread ? "font-semibold text-[#20352c]" : "text-[#34483f]")}>{thread.title}</span>
                                      <span className="shrink-0 text-[12px] text-[#8a968e]">{inboxListTime(thread.timestamp)}</span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })() : (
                  <div className="flex flex-1 flex-col items-center justify-center px-6 py-20 text-center">
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#f1f4ee] text-[#7a877f]">
                      <MessagesIcon className="h-6 w-6" />
                    </span>
                    <div className="mt-3 text-[15px] font-semibold text-[#20352c]">Select a message</div>
                    <p className="mt-1 text-[13px] text-[#7a877f]">Choose a message from your inbox to read it here.</p>
                  </div>
                )}
              </div>
            </div>
          </DashboardReveal>
        </section>
      );
    }

    return (
      <section className="section-swipe-settle">
        <DashboardWalletView
          loading={loading}
          payoutBatches={payoutBatches}
          wallet={walletBalance}
          accountEarnings={accountEarnings}
          earningsLoading={earningsLoading}
          earningsError={earningsError}
          onOpenAccounts={() => navigateFromView("accounts")}
          assignmentsCount={normalizedAssignments.length}
          workerId={workerId}
        />
      </section>
    );
  };

  const directApplyModalGig = directApplyTargetGig;

  return (
    <>
      <DashboardPageShell
        onGlobalSearch={(query) => {
          setSearchText(query);
          setPlatformFilter("All");
          setLocationFilter("All regions");
          navigateFromView("find");
        }}
        currentSection={currentSection}
        setCurrentSection={setCurrentSection}
        profileName={profileDisplayName}
        profileEmail={profileEmailDisplay}
        profileRole={displayProfileRole}
        profileSyncLabel={profileSyncLabel}
        workerId={workerId}
        language={activeLanguage}
        setLanguage={setLanguageCode}
        strings={strings}
        loading={loading}
        onLogout={logout}
        navBadges={{ messages: unreadCount, accounts: socialAccounts.load.state === "ready" ? socialAccounts.load.accountIssues?.length ?? 0 : 0 }}
        walletSummary={{ credited: accountEarnings?.approved ?? payoutSummary.credited, pending: accountEarnings?.pending ?? payoutSummary.pending, estimated: Boolean(accountEarnings), walletVerified: accountEarnings?.walletVerified, loading: earningsLoading, unavailable: socialAccounts.load.state === "error" }}
        liveStatus={{ syncing: liveSyncing || socialAccounts.refreshing, saved: usingSavedData, lastSyncedAt, onSync: () => { void refreshLiveData(true); void socialAccounts.refresh(currentSection === "accounts"); } }}
      >
        {error ? (
          <div className="mx-auto mb-6 w-full max-w-[1120px] rounded-[20px] border border-[#f0e1d9] bg-[#fff8f4] px-4 py-4 text-[14px] text-[#8b5a42]">
            {error}
          </div>
        ) : null}
        {currentSection !== "accounts" && socialAccounts.load.state === "ready" && socialAccounts.load.accountIssues?.length ? <AccountRecoveryNotice count={socialAccounts.load.accountIssues.length} onReview={() => navigateFromView("accounts")} /> : null}
        {renderSection()}
      </DashboardPageShell>

      {directApplyModalOpen &&
      directApplyModalGig &&
      typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[10025] flex items-end justify-center bg-[#0f1411]/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-4">
              <button
                type="button"
                aria-label="Close application dialog"
                tabIndex={-1}
                className="absolute inset-0 cursor-default"
                onClick={closeDirectApplyModal}
              />
              <div
                ref={directApplyDialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="direct-apply-title"
                aria-describedby="direct-apply-description"
                tabIndex={-1}
                className="dashboard-sheet-rise relative z-10 flex max-h-[92dvh] w-full max-w-[600px] flex-col overflow-hidden rounded-t-2xl bg-white shadow-[0_24px_64px_-16px_rgba(15,20,17,0.4)] outline-none sm:max-h-[min(88dvh,760px)] sm:rounded-xl"
              >
                {/* Grabber (phones) */}
                <div className="flex justify-center pt-2 sm:hidden" aria-hidden="true">
                  <span className="h-1 w-9 rounded-full bg-[#d5d9d4]" />
                </div>

                {/* Header */}
                <div className="flex items-start justify-between gap-3 border-b border-[#ebedea] px-4 pb-3.5 pt-2.5 sm:px-5 sm:pt-4">
                  <div className="min-w-0">
                    <h2 id="direct-apply-title" className="text-[16px] font-semibold text-[#1a201c] sm:text-[17px]">
                      Apply to this gig
                    </h2>
                    <p id="direct-apply-description" className="mt-0.5 text-[13px] leading-5 text-[#616a64]">
                      {directApplyTargetGig && isEmailCreatorGig(directApplyTargetGig)
                        ? "Instant approval: you can start right after applying. No proposal or screening."
                        : "Quick apply — your profile goes straight to recruiter screening. No proposal needed."}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close application dialog"
                    onClick={closeDirectApplyModal}
                    disabled={proposalSaving}
                    className="-mr-1.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#4b544e] transition hover:bg-[#f1f3f0] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40"
                  >
                    <UiIcon.Close className="h-4 w-4" />
                  </button>
                </div>

                {/* Body */}
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
                  {/* Gig summary */}
                  <div className="flex items-center gap-3 rounded-lg border border-[#ebedea] p-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#e3e5e1] bg-[#fafbf9] text-[13px] font-bold text-[#2b5d4a]" aria-hidden="true">
                      {getInitials(directApplyModalGig.company)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 text-[14px] font-semibold leading-5 text-[#1a201c]">{directApplyModalGig.title}</div>
                      <div className="truncate text-[12.5px] text-[#7a827c]">
                        {directApplyModalGig.company} · {compactLocationLabel(directApplyModalGig.location)} · {directApplyModalGig.platform}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-[11.5px] text-[#7a827c]">Payout</div>
                      <div className="max-w-[9rem] text-[14px] text-[#1a201c]"><JobPayout gig={directApplyModalGig} stacked /></div>
                    </div>
                  </div>

                  {/* Applicant */}
                  <section aria-labelledby="direct-apply-applicant">
                    <h3 id="direct-apply-applicant" className="text-[12.5px] font-semibold text-[#616a64]">
                      Applying as
                    </h3>
                    <div
                      className={cx(
                        "mt-1.5 flex items-center gap-3 rounded-lg border p-3",
                        directApplySubmissionEmail || directApplyContactLoading ? "border-[#ebedea] bg-[#fafbf9]" : "border-[#f3cdc8] bg-[#fdf2f1]"
                      )}
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1f2b24] text-[13px] font-semibold text-white" aria-hidden="true">
                        {getInitials(profileDisplayName)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-semibold text-[#1a201c]">{profileDisplayName}</div>
                        <div className={cx("truncate text-[12.5px]", directApplySubmissionEmail ? "text-[#616a64]" : "text-[#8e1f1a]")}>{directApplyContactValue}</div>
                      </div>
                      {directApplyContactLoading ? (
                        <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[#d5d9d4] border-t-[#1f2b24]" aria-label="Checking contact email" />
                      ) : (
                        <StatusBadge status={directApplyContactStatus} tone={directApplySubmissionEmail ? "success" : "critical"} />
                      )}
                    </div>
                    {!directApplySubmissionEmail && !directApplyContactLoading ? (
                      <div className="mt-2 flex flex-col gap-2 text-[12.5px] text-[#8e1f1a] min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between">
                        <span>Recruiters need an email to reach you.</span>
                        <UiButton
                          size="sm"
                          onClick={() => {
                            closeDirectApplyModal();
                            navigateFromView("profile");
                          }}
                        >
                          Add email in profile
                        </UiButton>
                      </div>
                    ) : (
                      <p className="mt-1.5 text-[12px] text-[#7a827c]">Used for your confirmation and recruiter updates.</p>
                    )}
                  </section>

                  {/* Weekly limit: what this application uses */}
                  {directApplyTargetGig && !quotaCoversGig(weeklyQuota, String(directApplyTargetGig.id)) ? (
                    <ApplicationSlotPreview quota={weeklyQuota} now={minuteNow} />
                  ) : null}

                  {/* Consent */}
                  <label
                    id="direct-apply-consent"
                    className={cx(
                      "flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition",
                      directApplyAgreementChecked
                        ? "border-[#b9d5c0] bg-[#f1f8ef]"
                        : directApplyError
                          ? "border-[#f3cdc8] bg-[#fdf2f1]"
                          : "border-[#e3e5e1] bg-white hover:bg-[#fafbf9]"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={directApplyAgreementChecked}
                      aria-invalid={!!directApplyError && !directApplyAgreementChecked}
                      aria-describedby="direct-apply-consent-hint"
                      onChange={(event) => {
                        setDirectApplyAgreementChecked(event.target.checked);
                        if (event.target.checked) setDirectApplyError(null);
                      }}
                      className="mt-0.5 h-[18px] w-[18px] shrink-0 rounded border-[#a9b0aa] accent-[#1f2b24] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2e7d4f]"
                    />
                    <span className="min-w-0">
                      <span className="block text-[13.5px] leading-6 text-[#1a201c]">{DIRECT_APPLY_CONSENT_TEXT}</span>
                      <span id="direct-apply-consent-hint" className="mt-0.5 block text-[12px] text-[#7a827c]">
                        Required to submit.
                      </span>
                    </span>
                  </label>

                  {/* Next steps */}
                  <section aria-labelledby="direct-apply-next">
                    <h3 id="direct-apply-next" className="text-[12.5px] font-semibold text-[#616a64]">
                      What happens next
                    </h3>
                    <ol className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-1 sm:gap-2.5">
                      {[
                        ["Submit", "Your profile is shared with the hiring team.", "Profile shared"],
                        ["Screening", `A recruiter reviews your fit. Current state: ${directApplyReviewStateLabel}.`, "Recruiter review"],
                        ["Decision", "The result appears in Jobs and Messages.", "In Jobs & Messages"],
                      ].map(([title, body, short], index) => (
                        <li key={title} className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-[#ebedea] p-2.5 sm:flex-row sm:gap-3 sm:border-0 sm:p-0">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#eef1ed] text-[11px] font-bold text-[#2b5d4a]">{index + 1}</span>
                          <span className="min-w-0 sm:pt-0.5">
                            <span className="block text-[12.5px] font-semibold text-[#1a201c] sm:text-[13px]">{title}</span>
                            <span className="block text-[11.5px] leading-4 text-[#616a64] sm:hidden">{short}</span>
                            <span className="hidden text-[12.5px] leading-5 text-[#616a64] sm:block">{body}</span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  </section>

                  {directApplyError ? (
                    <div role="alert" className="flex items-start gap-2 rounded-lg border border-[#f3cdc8] bg-[#fdf2f1] px-3.5 py-2.5 text-[13px] text-[#8e1f1a]">
                      <UiIcon.Close className="mt-0.5 h-4 w-4 shrink-0" />
                      {directApplyError}
                    </div>
                  ) : null}
                </div>

                {/* Footer */}
                <div
                  className="flex shrink-0 flex-col gap-2 border-t border-[#ebedea] bg-white px-4 pt-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:pb-4"
                  style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
                >
                  {!directApplyAgreementChecked ? (
                    <button
                      type="button"
                      onClick={() => {
                        const target = document.getElementById("direct-apply-consent");
                        target?.scrollIntoView({ behavior: "smooth", block: "center" });
                        target?.querySelector("input")?.focus({ preventScroll: true });
                      }}
                      className="text-center text-[12.5px] font-medium text-[#8a5a00] underline-offset-2 hover:underline sm:text-left"
                    >
                      Tick the confirmation above to submit
                    </button>
                  ) : (
                    <p className="hidden text-[12px] text-[#7a827c] sm:block">Track this application anytime in Jobs.</p>
                  )}
                  <div className="flex flex-col-reverse gap-2 sm:flex-row">
                    <UiButton onClick={closeDirectApplyModal} disabled={proposalSaving} size="lg" className="w-full sm:h-9 sm:w-auto sm:px-3.5 sm:text-[13px]">
                      Cancel
                    </UiButton>
                    <UiButton
                      variant="primary"
                      onClick={submitDashboardDirectApplication}
                      disabled={!directApplyCanSubmit}
                      size="lg"
                      className="w-full sm:h-9 sm:w-auto sm:px-3.5 sm:text-[13px]"
                    >
                      {proposalSaving ? (
                        <>
                          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
                          Submitting…
                        </>
                      ) : (
                        "Submit application"
                      )}
                    </UiButton>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {directApplySuccess && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[10025] flex items-end justify-center bg-[#0f1411]/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-4">
              <button type="button" tabIndex={-1} aria-label="Close" className="absolute inset-0 cursor-default" onClick={() => setDirectApplySuccess(null)} />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="direct-apply-success-title"
                aria-describedby="direct-apply-success-description"
                className="dashboard-sheet-rise relative z-10 flex max-h-[92dvh] w-full max-w-[480px] flex-col overflow-hidden rounded-t-2xl bg-white shadow-[0_24px_64px_-16px_rgba(15,20,17,0.4)] sm:rounded-xl"
              >
                <div className="flex justify-center pt-2 sm:hidden" aria-hidden="true">
                  <span className="h-1 w-9 rounded-full bg-[#d5d9d4]" />
                </div>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setDirectApplySuccess(null)}
                  className="absolute right-2.5 top-2.5 inline-flex h-9 w-9 items-center justify-center rounded-lg text-[#4b544e] transition hover:bg-[#f1f3f0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40 sm:right-3 sm:top-3"
                >
                  <UiIcon.Close className="h-4 w-4" />
                </button>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-5 sm:px-6 sm:pt-7">
                  <div className="flex flex-col items-center text-center">
                    <span className="dashboard-success-badge relative flex h-14 w-14 items-center justify-center rounded-full bg-[#e3f1df]" aria-hidden="true">
                      <span className="dashboard-success-ring absolute inset-0 rounded-full border-2 border-[#2e7d4f]/30" />
                      <svg viewBox="0 0 24 24" className="h-7 w-7 text-[#2e7d4f]" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path className="dashboard-success-check" d="m5.5 12.5 4.2 4.2L18.5 7.8" />
                      </svg>
                    </span>
                    <h2 id="direct-apply-success-title" className="mt-4 text-[18px] font-semibold text-[#1a201c]">
                      {directApplySuccess.instant ? "You're approved" : "Application sent"}
                    </h2>
                    <p id="direct-apply-success-description" className="mt-1 max-w-[36ch] text-[13.5px] leading-5 text-[#616a64]">
                      {directApplySuccess.instant ? (
                        <>
                          Approved instantly for <span className="font-semibold text-[#1a201c]">{directApplySuccess.title}</span>. Your work emails and inbox are opening now.
                        </>
                      ) : (
                        <>
                          You&apos;re in recruiter screening for <span className="font-semibold text-[#1a201c]">{directApplySuccess.title}</span> at {directApplySuccess.company}.
                          {directApplySuccess.setupPlatform ? " One quick step left before you can post." : null}
                        </>
                      )}
                    </p>
                  </div>

                  {directApplySuccess.setupPlatform ? (
                    <AccountSetupCountdown key={directApplySuccess.gigId} platform={directApplySuccess.setupPlatform} onGo={() => openAccountSetupFromSuccess(directApplySuccess.gigId)} />
                  ) : null}

                  <dl className="mt-5 divide-y divide-[#f0f1ef] rounded-lg border border-[#ebedea] text-[13px]">
                    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <dt className="text-[#616a64]">Status</dt>
                      <dd>
                        <StatusBadge status="In screening" tone="info" />
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <dt className="text-[#616a64]">Payout</dt>
                      <dd className="min-w-0 text-[#1a201c]"><JobPayout gig={directApplySuccess} stacked /></dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <dt className="text-[#616a64]">Submitted</dt>
                      <dd className="font-medium text-[#1a201c]">
                        {new Date(directApplySuccess.submittedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                      </dd>
                    </div>
                  </dl>

                  <div
                    className={cx(
                      "mt-3 flex items-start gap-2.5 rounded-lg px-3.5 py-2.5 text-[12.5px] leading-5",
                      directApplySuccess.emailSent ? "bg-[#fafbf9] text-[#4b544e] ring-1 ring-inset ring-[#ebedea]" : "bg-[#fff8e1] text-[#6b4a05] ring-1 ring-inset ring-[#f1dea6]"
                    )}
                  >
                    <MessagesIcon className="mt-0.5 h-4 w-4 shrink-0" />
                    {directApplySuccess.emailSent ? (
                      <span>
                        Confirmation sent to <span className="font-semibold text-[#1a201c]">{directApplySuccess.email}</span>.
                      </span>
                    ) : (
                      <span>We couldn&apos;t email a confirmation, but your application is saved. Track every update here in your dashboard.</span>
                    )}
                  </div>

                  <ol className="mt-5 grid grid-cols-3 gap-2" aria-label="Application progress">
                    {[
                      { label: "Applied", state: "done" },
                      directApplySuccess.setupPlatform ? { label: "Account setup", state: "current" } : { label: "Screening", state: "current" },
                      { label: "Decision", state: "todo" },
                    ].map((step) => (
                      <li key={step.label} className="min-w-0">
                        <div
                          className={cx(
                            "h-1.5 rounded-full",
                            step.state === "done" && "bg-[#2e7d4f]",
                            step.state === "current" && "bg-[linear-gradient(90deg,#2e7d4f,#cfe3d4)]",
                            step.state === "todo" && "bg-[#eaece8]"
                          )}
                        />
                        <div className={cx("mt-1.5 flex items-center justify-center gap-1 text-[12px] font-semibold", step.state === "todo" ? "text-[#9aa29c]" : "text-[#1a201c]")}>
                          {step.state === "done" ? <UiIcon.Check className="h-3 w-3 text-[#2e7d4f]" /> : null}
                          {step.state === "current" ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#2e7d4f]" aria-hidden="true" /> : null}
                          {step.label}
                        </div>
                      </li>
                    ))}
                  </ol>
                  <p className="mt-2 text-center text-[12px] text-[#7a827c]">
                    {directApplySuccess.instant
                      ? "No waiting: your five work emails and their inbox are ready on the gig page."
                      : directApplySuccess.setupPlatform
                        ? "Your application stays in screening while you set up the account."
                        : "The decision will appear in Jobs and Messages."}
                  </p>
                </div>

                <div
                  className="flex shrink-0 flex-col gap-2 border-t border-[#ebedea] px-5 pt-3 sm:flex-row-reverse sm:px-6 sm:pb-4"
                  style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
                >
                  <UiButton
                    ref={directApplySuccessPrimaryRef}
                    variant="primary"
                    size="lg"
                    className="w-full sm:h-9 sm:flex-1 sm:text-[13px]"
                    onClick={() => {
                      const gigId = directApplySuccess.gigId;
                      if (directApplySuccess.setupPlatform) return openAccountSetupFromSuccess(gigId);
                      const instant = directApplySuccess.instant;
                      setDirectApplySuccess(null);
                      navigateFromView("find", { gigId, intent: "details" });
                      if (instant) requestGigWorkStart(gigId);
                    }}
                  >
                    {directApplySuccess.instant ? "Open my work emails" : directApplySuccess.setupPlatform ? "Set up account now" : "View application"}
                  </UiButton>
                  <UiButton
                    size="lg"
                    className="w-full sm:h-9 sm:flex-1 sm:text-[13px]"
                    onClick={() => {
                      setDirectApplySuccess(null);
                      navigateFromView("find");
                    }}
                  >
                    Browse more gigs
                  </UiButton>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
