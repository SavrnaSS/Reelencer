"use client";

import { useId } from "react";
import type { ApplicationQueueFilter } from "@/lib/adminApplicationQueue";
import styles from "./ApplicationQueueFilters.module.css";

const ACCOUNT_FILTERS = [
  { value: "All", label: "All", shortLabel: "All" },
  { value: "Account sent", label: "Account sent", shortLabel: "Sent" },
  { value: "Without account", label: "No account", shortLabel: "No account" },
] as const;
const REVIEW_FILTERS = ["Pending", "Accepted", "Rejected", "Withdrawn"] as const;

export default function ApplicationQueueFilters({
  value,
  counts,
  onChange,
}: {
  value: ApplicationQueueFilter;
  counts: Record<ApplicationQueueFilter, number>;
  onChange: (filter: ApplicationQueueFilter) => void;
}) {
  const reviewId = useId();
  const reviewing = REVIEW_FILTERS.find(filter => filter === value);
  const formatCount = (count: number) => count.toLocaleString("en-IN");

  return (
    <div className={styles.filters}>
      <div className={styles.accounts} role="group" aria-label="Filter by account submission">
        {ACCOUNT_FILTERS.map(filter => (
          <button
            key={filter.value}
            type="button"
            className={styles.account}
            aria-pressed={value === filter.value}
            aria-label={`${filter.value}: ${formatCount(counts[filter.value])} applications`}
            title={`${filter.value}: ${formatCount(counts[filter.value])} applications`}
            onClick={() => onChange(filter.value)}
          >
            <span className={styles.accountLabel}>
              <span className={styles.fullLabel}>{filter.label}</span>
              <span className={styles.shortLabel}>{filter.shortLabel}</span>
            </span>
            <span className={styles.accountCount}>{formatCount(counts[filter.value])}</span>
          </button>
        ))}
      </div>
      <div className={styles.review}>
        <label htmlFor={reviewId}>Review status</label>
        <div className={styles.selectWrap}>
          <select
            id={reviewId}
            value={reviewing ?? "All"}
            className={styles.select}
            data-active={Boolean(reviewing)}
            onChange={event => onChange(event.target.value as ApplicationQueueFilter)}
          >
            <option value="All">All statuses</option>
            {REVIEW_FILTERS.map(filter => (
              <option key={filter} value={filter}>{filter} · {formatCount(counts[filter])}</option>
            ))}
          </select>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className={styles.chevron} aria-hidden="true">
            <path d="m5 8 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    </div>
  );
}
