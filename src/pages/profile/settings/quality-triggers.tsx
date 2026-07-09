import UserSettings from '@app/components/UserProfile/UserSettings';
import UserQualityTriggers from '@app/components/UserProfile/UserSettings/UserQualityTriggers';
import type { NextPage } from 'next';

const UserQualityTriggersPage: NextPage = () => {
  return (
    <UserSettings>
      <UserQualityTriggers />
    </UserSettings>
  );
};

export default UserQualityTriggersPage;
