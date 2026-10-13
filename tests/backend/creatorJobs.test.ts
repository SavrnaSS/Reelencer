import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreatorJobs, creatorJobCounts, type CreatorJobApplication, type CreatorJobAssignment } from '../../lib/creatorJobs';

const date = (day: number) => `2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`;
const gig = { id: 'gig-1', title: 'Record a reaction video', payout: '₹49', payoutType: 'Per 1k Views' };
const gigs = new Map([[gig.id, gig]]);
const app = (overrides: Partial<CreatorJobApplication> = {}): CreatorJobApplication => ({ id: 'app-1', gigId: gig.id, status: 'Accepted', appliedAt: date(1), decidedAt: date(2), ...overrides });
const assignment = (overrides: Partial<CreatorJobAssignment> = {}): CreatorJobAssignment => ({ id: 'work-1', gigKey: gig.id, statusLabel: 'Assigned', createdAt: date(3), primaryDate: date(3), ...overrides });

test('an accepted application is one active job with work still ahead', () => {
  const [row] = buildCreatorJobs([app()], [], gigs);
  assert.equal(row.status, 'Accepted');
  assert.equal(row.group, 'active');
  assert.equal(row.stage, 2);
  assert.equal(row.gig?.payoutType, 'Per 1k Views');
  assert.deepEqual(creatorJobCounts([row]), { all: 1, review: 0, active: 1, submitted: 0, done: 0, closed: 0 });
});

test('application and work records for the same gig form one ongoing journey', () => {
  const application = app();
  const work = assignment({ statusLabel: 'Submitted', submittedAt: date(4) });
  const rows = buildCreatorJobs([application], [work], gigs);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'Submitted');
  assert.equal(rows[0].stage, 3);
  assert.equal(rows[0].date, date(4));
  assert.equal(rows[0].startedAt, date(1));
  assert.equal(rows[0].application, application);
  assert.equal(rows[0].assignment, work);
  assert.equal(rows[0].key, buildCreatorJobs([application], [], gigs)[0].key);
});

test('duplicate cached records select the latest record rather than adding rows', () => {
  const rows = buildCreatorJobs([
    app({ id: 'old', status: 'Pending', decidedAt: date(1) }),
    app({ id: 'new', decidedAt: date(4) }),
  ], [
    assignment({ id: 'old-work', statusLabel: 'Approved', primaryDate: date(3) }),
    assignment({ id: 'new-work', statusLabel: 'Assigned', primaryDate: date(5) }),
  ], gigs);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].application?.id, 'new');
  assert.equal(rows[0].assignment?.id, 'new-work');
  assert.equal(rows[0].status, 'Assigned');
  assert.equal(rows[0].stage, 2);
});

test('work progress is retained when an application snapshot arrives later', () => {
  const [row] = buildCreatorJobs([app({ status: 'Pending', decidedAt: date(8) })], [assignment({ statusLabel: 'Submitted', submittedAt: date(7) })], gigs);
  assert.equal(row.status, 'Submitted');
  assert.equal(row.group, 'submitted');
  assert.equal(row.date, date(8));
});

test('proof-review acceptance advances to approval without inventing a paid payout', () => {
  const [row] = buildCreatorJobs([app()], [assignment({ statusLabel: 'Accepted', submittedAt: date(4), decidedAt: date(5) })], gigs);
  assert.equal(row.status, 'Approved');
  assert.equal(row.group, 'done');
  assert.equal(row.stage, 4);
  assert.equal(row.date, date(5));
  const [paid] = buildCreatorJobs([app()], [assignment({ statusLabel: 'Paid', primaryDate: date(6) })], gigs);
  assert.equal(paid.status, 'Paid');
  assert.equal(paid.stage, 5);
});

test('closed applications and rejected work keep their real outcome', () => {
  const [closed] = buildCreatorJobs([app({ status: 'Rejected' })], [], gigs);
  assert.equal(closed.status, 'Not selected');
  assert.equal(closed.group, 'closed');
  assert.equal(closed.stage, 1);
  const [rejected] = buildCreatorJobs([app()], [assignment({ statusLabel: 'Rejected', submittedAt: date(4) })], gigs);
  assert.equal(rejected.status, 'Rejected');
  assert.equal(rejected.group, 'closed');
  assert.equal(rejected.stage, 3);
});

test('directly assigned work remains visible without an application record', () => {
  const [row] = buildCreatorJobs([], [assignment()], gigs);
  assert.equal(row.status, 'Assigned');
  assert.equal(row.group, 'active');
  assert.equal(row.startedAt, date(3));
  assert.equal(row.application, undefined);
});

test('latest review and work activity sorts all jobs together', () => {
  const rows = buildCreatorJobs([
    app({ gigId: 'old-app', id: 'old', appliedAt: date(1), decidedAt: date(2) }),
    app({ gigId: 'new-decision', id: 'decision', appliedAt: date(1), decidedAt: date(8) }),
  ], [assignment({ gigKey: 'new-work', submittedAt: date(9), primaryDate: date(3), statusLabel: 'Submitted' })], gigs);
  assert.deepEqual(rows.map(row => row.gigId), ['new-work', 'new-decision', 'old-app']);
});

test('missing gig metadata does not hide work or create duplicate jobs', () => {
  const rows = buildCreatorJobs([app()], [assignment()], new Map());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].gig, null);
  assert.equal(rows[0].status, 'Assigned');
});

test('missing gig identifiers do not merge unrelated records', () => {
  const rows = buildCreatorJobs([app({ gigId: '', id: 'unknown-app' })], [assignment({ gigKey: '', id: 'unknown-work' })], gigs);
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map(row => row.key)).size, 2);
});

test('invalid dates use available real timestamps and never fabricate a current update', () => {
  const [row] = buildCreatorJobs([app({ decidedAt: 'invalid' })], [assignment({ primaryDate: 'invalid', createdAt: undefined, submittedAt: undefined })], gigs);
  assert.equal(row.date, date(1));
  assert.equal(row.startedAt, date(1));
  const [unknown] = buildCreatorJobs([app({ appliedAt: '', decidedAt: undefined })], [], gigs);
  assert.equal(unknown.date, undefined);
  assert.equal(unknown.startedAt, undefined);
});

test('all phase counts total the unique gigs across both sources', () => {
  const rows = buildCreatorJobs([
    app({ gigId: 'review', status: 'Pending' }),
    app({ gigId: 'active' }),
    app({ gigId: 'submitted' }),
    app({ gigId: 'closed', status: 'Withdrawn' }),
  ], [
    assignment({ gigKey: 'active' }),
    assignment({ gigKey: 'submitted', statusLabel: 'Pending', submittedAt: date(4) }),
    assignment({ gigKey: 'done', statusLabel: 'Accepted' }),
  ], gigs);
  assert.deepEqual(creatorJobCounts(rows), { all: 5, review: 1, active: 1, submitted: 1, done: 1, closed: 1 });
});

test('normalization preserves immutable input records and the gig payout', () => {
  const application = Object.freeze(app({ gigId: ' gig-1 ', status: ' accepted ' }));
  const work = Object.freeze(assignment({ statusLabel: ' in_review ' }));
  const applications = Object.freeze([application]);
  const assignments = Object.freeze([work]);
  const [row] = buildCreatorJobs(applications, assignments, gigs);
  assert.equal(row.gigId, gig.id);
  assert.equal(row.gig, gig);
  assert.equal(row.group, 'submitted');
  assert.equal(row.gig?.payout, '₹49');
  assert.equal(application.gigId, ' gig-1 ');
  assert.equal(work.statusLabel, ' in_review ');
});
