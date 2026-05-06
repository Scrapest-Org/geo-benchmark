const subtaskVersions = {
  action_list: 2,
  alert_dialog: 1,
  app_download_cta: 1,
  check_logged_in_account: 1,
  choice_selection: 3,
  contacts_live_sync_permission_prompt: 0,
  cta: 7,
  email_verification: 2,
  end_flow: 1,
  enter_date: 1,
  enter_email: 2,
  enter_password: 5,
  enter_phone: 2,
  enter_recaptcha: 1,
  enter_text: 5,
  enter_username: 2,
  generic_urt: 3,
  in_app_notification: 1,
  interest_picker: 3,
  js_instrumentation: 1,
  menu_dialog: 1,
  notifications_permission_prompt: 2,
  open_account: 2,
  open_home_timeline: 1,
  open_link: 1,
  phone_verification: 4,
  privacy_options: 1,
  security_key: 3,
  select_avatar: 4,
  select_banner: 2,
  settings_list: 7,
  show_code: 1,
  sign_up: 2,
  sign_up_review: 4,
  tweet_selection_urt: 1,
  update_users: 1,
  upload_media: 1,
  user_recommendations_list: 4,
  user_recommendations_urt: 1,
  wait_spinner: 3,
  web_modal: 1,
} as const;

const inputFlowData = {
  flow_context: {
    debug_overrides: {},
    start_location: { location: "unknown" },
  },
} as const;

const subtaskInputs = [
  {
    js_instrumentation: {
      link: "next_link",
      response: "{}",
    },
    subtask_id: "LoginJsInstrumentationSubtask",
  },
];

const userIdentSubtaskInput = (account: string) => [
  {
    settings_list: {
      link: "next_link",
      setting_responses: [
        {
          key: "user_identifier",
          response_data: {
            text_data: {
              result: account,
            },
          },
        },
      ],
    },
    subtask_id: "LoginEnterUserIdentifierSSO",
  },
];

const altIdentSubtaskInput = (account: string) => [
  {
    enter_text: {
      link: "next_link",
      text: account, // or phone number
    },
    subtask_id: "LoginEnterAlternateIdentifierSubtask",
  },
];

const passwordSubtaskInput = (password: string) => [
  {
    enter_password: {
      link: "next_link",
      password,
    },
    subtask_id: "LoginEnterPassword",
  },
];

const dupCheckSubtaskInput = [
  {
    check_logged_in_account: {
      link: "AccountDuplicationCheck_false",
    },
    subtask_id: "AccountDuplicationCheck",
  },
];

const twoFactorAuthChooseMethodSubtaskInput = [
  {
    choice_selection: {
      link: "next_link",
      selected_choices: ["0"],
    },
    subtask_id: "LoginTwoFactorAuthChooseMethod",
  },
];

const tfaSubtaskInput = (tfaCode: string) => [
  {
    enter_text: {
      link: "next_link",
      text: tfaCode,
    },
    subtask_id: "LoginTwoFactorAuthChallenge",
  },
];

const viewerFeatures = {
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
};

export {
  subtaskVersions,
  inputFlowData,
  subtaskInputs,
  userIdentSubtaskInput,
  altIdentSubtaskInput,
  passwordSubtaskInput,
  dupCheckSubtaskInput,
  twoFactorAuthChooseMethodSubtaskInput,
  tfaSubtaskInput,
  viewerFeatures,
};
