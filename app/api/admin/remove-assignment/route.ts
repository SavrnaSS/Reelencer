import { withApi } from '@/lib/api/route';
import { removeAssignment } from '@/lib/api/adminAccounts';
export const POST = withApi({ auth: 'admin' }, removeAssignment);
