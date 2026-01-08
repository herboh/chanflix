import Header from '@app/components/Common/Header';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import { BookOpenIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/outline';
import ReactMarkdown from 'react-markdown';
import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages({
  docs: 'Documentation',
  userGuide: 'User Guide',
  faq: 'FAQ',
  docsDescription: 'Everything you need to know about using Chanflix',
});

type DocTab = 'user-guide' | 'faq';

const DocsPage = () => {
  const intl = useIntl();
  const [activeTab, setActiveTab] = useState<DocTab>('user-guide');

  const { data, error } = useSWR<{ content: string }>(
    `/api/v1/docs/${activeTab}`
  );

  const tabs = [
    {
      id: 'user-guide' as DocTab,
      label: intl.formatMessage(messages.userGuide),
      icon: BookOpenIcon,
    },
    {
      id: 'faq' as DocTab,
      label: intl.formatMessage(messages.faq),
      icon: QuestionMarkCircleIcon,
    },
  ];

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.docs)} />
      <div className="mb-4">
        <Header subtext={intl.formatMessage(messages.docsDescription)}>
          {intl.formatMessage(messages.docs)}
        </Header>
      </div>

      {/* Tab Navigation */}
      <div className="mb-6 flex space-x-1 rounded-lg bg-gray-800 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex flex-1 items-center justify-center space-x-2 rounded-md px-4 py-2 text-sm font-medium transition duration-150 ${
              activeTab === tab.id
                ? 'bg-indigo-600 text-white'
                : 'text-gray-400 hover:bg-gray-700 hover:text-white'
            }`}
          >
            <tab.icon className="h-5 w-5" />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="rounded-lg bg-gray-800 p-6 shadow-lg ring-1 ring-gray-700">
        {!data && !error ? (
          <LoadingSpinner />
        ) : error ? (
          <div className="text-center text-gray-400">
            Failed to load documentation
          </div>
        ) : (
          <div className="prose prose-invert max-w-none prose-headings:text-gray-100 prose-p:text-gray-300 prose-strong:text-gray-100 prose-li:text-gray-300">
            <ReactMarkdown>{data?.content || ''}</ReactMarkdown>
          </div>
        )}
      </div>
    </>
  );
};

export default DocsPage;
