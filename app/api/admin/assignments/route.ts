import { withApi } from '@/lib/api/route';
import { removeAssignment } from '@/lib/api/adminAccounts';
export { POST } from '../assign-account/route';
export const DELETE = withApi({ auth: 'admin' }, removeAssignment);
