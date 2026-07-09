import UserSettings from '@app/components/UserProfile/UserSettings';
import UserQualityTriggers from '@app/components/UserProfile/UserSettings/UserQualityTriggers';
import useRouteGuard from '@app/hooks/useRouteGuard';
import { Permission } from '@app/hooks/useUser';
import type { NextPage } from 'next';

const UserQualityTriggersPage: NextPage = () => {
  useRouteGuard(Permission.MANAGE_USERS);
  return (
    <UserSettings>
      <UserQualityTriggers />
    </UserSettings>
  );
};

export default UserQualityTriggersPage;
