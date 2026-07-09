import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import Error from '@app/pages/_error';
import { ArrowDownOnSquareIcon } from '@heroicons/react/24/outline';
import type { UserSettingsQualityTriggersResponse } from '@server/interfaces/api/userSettingsInterfaces';
import axios from 'axios';
import { Field, Form, Formik } from 'formik';
import { useRouter } from 'next/router';
import { defineMessages, useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';
import useSWR from 'swr';

const messages = defineMessages({
  qualitytriggers: 'Quality Triggers',
  qualitytriggersdescription:
    'Per-user quality rules applied when requests are sent to Radarr/Sonarr. Trigger rules are not active yet — this only stores the configuration.',
  toastSettingsSuccess: 'Quality trigger settings saved successfully!',
  toastSettingsFailure: 'Something went wrong while saving settings.',
  enabletriggers: 'Enable Quality Triggers',
  enabletriggerstip: 'Evaluate quality trigger rules for this user’s requests',
  profileceiling: 'Quality Profile Ceiling',
  profileceilingtip: 'Coming soon — rule details will be configurable here',
  unauthorizedDescription:
    "You do not have permission to modify this user's quality triggers.",
});

const UserQualityTriggers = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const router = useRouter();
  const { user: currentUser, hasPermission } = useUser();
  const { user } = useUser({
    id: Number(router.query.userId),
  });
  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<UserSettingsQualityTriggersResponse>(
    user ? `/api/v1/user/${user.id}/settings/quality-triggers` : null
  );

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  if (!data) {
    return <Error statusCode={500} />;
  }

  const canEdit =
    hasPermission(Permission.MANAGE_USERS) &&
    !(user?.id === 1 && currentUser?.id !== 1);

  return (
    <>
      <PageTitle
        title={[
          intl.formatMessage(messages.qualitytriggers),
          intl.formatMessage(globalMessages.usersettings),
          user?.displayName,
        ]}
      />
      <div className="mb-6">
        <h3 className="heading">
          {intl.formatMessage(messages.qualitytriggers)}
        </h3>
        <h6 className="description">
          {intl.formatMessage(messages.qualitytriggersdescription)}
        </h6>
      </div>
      {!canEdit && (
        <Alert
          title={intl.formatMessage(messages.unauthorizedDescription)}
          type="info"
        />
      )}
      <Formik
        initialValues={{
          enabled: data.qualityTriggers.enabled ?? false,
          maxProfileId: data.qualityTriggers.maxProfileId,
        }}
        enableReinitialize
        onSubmit={async (values) => {
          try {
            await axios.post(
              `/api/v1/user/${user?.id}/settings/quality-triggers`,
              {
                qualityTriggers: {
                  enabled: values.enabled,
                  maxProfileId: values.maxProfileId,
                },
              }
            );

            addToast(intl.formatMessage(messages.toastSettingsSuccess), {
              autoDismiss: true,
              appearance: 'success',
            });
          } catch (e) {
            addToast(intl.formatMessage(messages.toastSettingsFailure), {
              autoDismiss: true,
              appearance: 'error',
            });
          } finally {
            revalidate();
          }
        }}
      >
        {({ isSubmitting, setFieldValue, values }) => {
          return (
            <Form className="section">
              <div className="form-row">
                <label htmlFor="enabled" className="checkbox-label">
                  <span>{intl.formatMessage(messages.enabletriggers)}</span>
                  <span className="label-tip">
                    {intl.formatMessage(messages.enabletriggerstip)}
                  </span>
                </label>
                <div className="form-input-area">
                  <Field
                    type="checkbox"
                    id="enabled"
                    name="enabled"
                    disabled={!canEdit}
                    onChange={() => {
                      setFieldValue('enabled', !values.enabled);
                    }}
                  />
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="maxProfileId" className="text-label">
                  <span>{intl.formatMessage(messages.profileceiling)}</span>
                  <span className="label-tip">
                    {intl.formatMessage(messages.profileceilingtip)}
                  </span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <select id="maxProfileId" name="maxProfileId" disabled>
                      <option>Coming soon</option>
                    </select>
                  </div>
                </div>
              </div>
              {canEdit && (
                <div className="actions">
                  <div className="flex justify-end">
                    <span className="ml-3 inline-flex rounded-md shadow-sm">
                      <Button
                        buttonType="primary"
                        type="submit"
                        disabled={isSubmitting}
                      >
                        <ArrowDownOnSquareIcon />
                        <span>
                          {isSubmitting
                            ? intl.formatMessage(globalMessages.saving)
                            : intl.formatMessage(globalMessages.save)}
                        </span>
                      </Button>
                    </span>
                  </div>
                </div>
              )}
            </Form>
          );
        }}
      </Formik>
    </>
  );
};

export default UserQualityTriggers;
