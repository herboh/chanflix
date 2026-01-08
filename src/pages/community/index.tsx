import Header from '@app/components/Common/Header';
import PageTitle from '@app/components/Common/PageTitle';
import {
  ChatBubbleLeftRightIcon,
  StarIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  community: 'Community',
  communityDescription: 'Connect with other Chanflix users',
  messageBoard: 'Message Board',
  messageBoardDescription: 'Chat and discuss with other users',
  reviews: 'Reviews',
  reviewsDescription: 'See what others are watching and rating',
});

const CommunityPage = () => {
  const intl = useIntl();

  const sections = [
    {
      href: '/community/board',
      title: intl.formatMessage(messages.messageBoard),
      description: intl.formatMessage(messages.messageBoardDescription),
      icon: ChatBubbleLeftRightIcon,
    },
    {
      href: '/community/reviews',
      title: intl.formatMessage(messages.reviews),
      description: intl.formatMessage(messages.reviewsDescription),
      icon: StarIcon,
    },
  ];

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.community)} />
      <div className="mb-6">
        <Header subtext={intl.formatMessage(messages.communityDescription)}>
          {intl.formatMessage(messages.community)}
        </Header>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {sections.map((section) => (
          <Link key={section.href} href={section.href}>
            <a className="group flex items-center space-x-4 rounded-lg bg-gray-800 p-6 shadow ring-1 ring-gray-700 transition duration-300 hover:bg-gray-750 hover:ring-indigo-500">
              <div className="flex-shrink-0 rounded-lg bg-indigo-600 p-3 transition duration-300 group-hover:bg-indigo-500">
                <section.icon className="h-8 w-8 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-medium text-gray-100">
                  {section.title}
                </h3>
                <p className="text-sm text-gray-400">{section.description}</p>
              </div>
            </a>
          </Link>
        ))}
      </div>
    </>
  );
};

export default CommunityPage;
