import Button from '@app/components/Common/Button';
import Header from '@app/components/Common/Header';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import { useUser } from '@app/hooks/useUser';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/solid';
import type { User } from '@server/entity/User';
import axios from 'axios';
import { Field, Form, Formik } from 'formik';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { defineMessages, FormattedRelativeTime, useIntl } from 'react-intl';
import useSWR from 'swr';
import * as Yup from 'yup';

const messages = defineMessages({
  community: 'Community Board',
  communityDescription: 'Chat with other Chanflix users',
  newPost: 'Write a message...',
  post: 'Post',
  noMessages: 'No messages yet. Be the first to post!',
  messageRequired: 'Message is required',
});

interface BoardPost {
  id: number;
  user: User;
  message: string;
  createdAt: string;
  updatedAt: string;
}

interface BoardPostResultsResponse {
  pageInfo: {
    pages: number;
    pageSize: number;
    results: number;
    page: number;
  };
  results: BoardPost[];
}

const BoardList = () => {
  const intl = useIntl();
  const router = useRouter();
  const { user: currentUser } = useUser();

  const page = router.query.page ? Number(router.query.page) : 1;
  const pageIndex = page - 1;
  const pageSize = 20;

  const { data, error, mutate } = useSWR<BoardPostResultsResponse>(
    `/api/v1/board?take=${pageSize}&skip=${pageIndex * pageSize}`
  );

  const PostSchema = Yup.object().shape({
    message: Yup.string().required(intl.formatMessage(messages.messageRequired)),
  });

  const handleSubmit = async (
    values: { message: string },
    { resetForm }: { resetForm: () => void }
  ) => {
    try {
      await axios.post('/api/v1/board', { message: values.message });
      resetForm();
      mutate();
    } catch (e) {
      // Handle error
    }
  };

  const handleDelete = async (postId: number) => {
    try {
      await axios.delete(`/api/v1/board/${postId}`);
      mutate();
    } catch (e) {
      // Handle error
    }
  };

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  const hasNextPage = data ? data.pageInfo.pages > pageIndex + 1 : false;
  const hasPrevPage = pageIndex > 0;

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.community)} />
      <div className="mb-6">
        <Header subtext={intl.formatMessage(messages.communityDescription)}>
          {intl.formatMessage(messages.community)}
        </Header>
      </div>

      {/* New Post Form */}
      <div className="mb-6 rounded-lg bg-gray-800 p-4 shadow-lg ring-1 ring-gray-700">
        <Formik
          initialValues={{ message: '' }}
          validationSchema={PostSchema}
          onSubmit={handleSubmit}
        >
          {({ isSubmitting, isValid }) => (
            <Form className="flex space-x-4">
              <div className="flex-shrink-0">
                <img
                  src={currentUser?.avatar}
                  alt=""
                  className="h-10 w-10 rounded-full object-cover ring-1 ring-gray-600"
                />
              </div>
              <div className="flex-grow">
                <Field
                  as="textarea"
                  name="message"
                  placeholder={intl.formatMessage(messages.newPost)}
                  className="h-20 w-full resize-none rounded-md border-gray-600 bg-gray-700 text-white placeholder-gray-400 focus:border-indigo-500 focus:ring-indigo-500"
                />
              </div>
              <div className="flex-shrink-0">
                <Button
                  buttonType="primary"
                  type="submit"
                  disabled={isSubmitting || !isValid}
                >
                  {intl.formatMessage(messages.post)}
                </Button>
              </div>
            </Form>
          )}
        </Formik>
      </div>

      {/* Posts List */}
      <div className="space-y-4">
        {data?.results.length === 0 ? (
          <div className="rounded-lg bg-gray-800 p-8 text-center text-gray-400">
            {intl.formatMessage(messages.noMessages)}
          </div>
        ) : (
          data?.results.map((post) => (
            <div
              key={post.id}
              className="rounded-lg bg-gray-800 p-4 shadow ring-1 ring-gray-700"
            >
              <div className="flex space-x-4">
                <Link href={`/users/${post.user.id}`}>
                  <a className="flex-shrink-0">
                    <img
                      src={post.user.avatar}
                      alt=""
                      className="h-10 w-10 rounded-full object-cover ring-1 ring-gray-600 transition duration-300 hover:ring-indigo-500"
                    />
                  </a>
                </Link>
                <div className="flex-grow">
                  <div className="flex items-center justify-between">
                    <div>
                      <Link href={`/users/${post.user.id}`}>
                        <a className="font-medium text-gray-100 hover:text-white hover:underline">
                          {post.user.displayName}
                        </a>
                      </Link>
                      <span className="ml-2 text-sm text-gray-500">
                        <FormattedRelativeTime
                          value={Math.floor(
                            (new Date(post.createdAt).getTime() - Date.now()) /
                              1000
                          )}
                          updateIntervalInSeconds={60}
                          numeric="auto"
                        />
                      </span>
                    </div>
                    {currentUser?.id === post.user.id && (
                      <button
                        onClick={() => handleDelete(post.id)}
                        className="text-sm text-gray-500 hover:text-red-500"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-gray-300">
                    {post.message}
                  </p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {data && data.pageInfo.pages > 1 && (
        <div className="mt-6 flex items-center justify-center space-x-4">
          <Button
            disabled={!hasPrevPage}
            onClick={() =>
              router.push({ query: { ...router.query, page: page - 1 } })
            }
          >
            <ChevronLeftIcon className="h-5 w-5" />
          </Button>
          <span className="text-gray-400">
            Page {page} of {data.pageInfo.pages}
          </span>
          <Button
            disabled={!hasNextPage}
            onClick={() =>
              router.push({ query: { ...router.query, page: page + 1 } })
            }
          >
            <ChevronRightIcon className="h-5 w-5" />
          </Button>
        </div>
      )}
    </>
  );
};

export default BoardList;
