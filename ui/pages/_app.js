import { CheckCircle, Error, Info, Warning } from '@mui/icons-material';
import FavoriteIcon from '@mui/icons-material/Favorite';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterMoment } from '@mui/x-date-pickers/AdapterMoment';
import 'billboard.js/dist/theme/dark.min.css';
import 'codemirror/addon/lint/lint.css';
// codemirror + js-yaml imports when added to a page was preventing to navigating to that page using nextjs
// link clicks, hence attempting to add them here
import 'codemirror/lib/codemirror.css';
import 'codemirror/theme/material.css';
import { fromJS } from 'immutable';
import _ from 'lodash';
import withRedux from 'next-redux-wrapper';
import App from 'next/app';
import Head from 'next/head';
import { SnackbarProvider } from 'notistack';
import React, { useEffect } from 'react';
import { connect, Provider, useSelector } from 'react-redux';
import Header from '../components/Header';
import MesheryProgressBar from '../components/MesheryProgressBar';
import Navigator from '../components/Navigator';
import getPageContext from '../components/PageContext';
import { MESHERY_CONTROLLER_SUBSCRIPTION } from '../components/subscription/helpers';
import { GQLSubscription } from '../components/subscription/subscriptionhandler';
import dataFetch, { promisifiedDataFetch } from '../lib/data-fetch';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import {
  actionTypes,
  makeStore,
  toggleCatalogContent,
  updateTelemetryUrls,
  setConnectionMetadata,
  LegacyStoreContext,
  setK8sContexts,
} from '../lib/store';
import { getConnectionIDsFromContextIds, getK8sConfigIdsFromK8sConfig } from '../utils/multi-ctx';
import './../public/static/style/index.css';
import subscribeK8sContext from '../components/graphql/subscriptions/K8sContextSubscription';
import { bindActionCreators } from 'redux';
import './styles/AnimatedFilter.css';
import './styles/AnimatedMeshery.css';
import './styles/AnimatedMeshPattern.css';
import './styles/AnimatedMeshSync.css';
import PlaygroundMeshDeploy from './extension/AccessMesheryModal';
import Router from 'next/router';
import { RelayEnvironmentProvider } from 'react-relay';
import { createRelayEnvironment } from '../lib/relayEnvironment';
import './styles/charts.css';
import uiConfig from '../ui.config';
import { NotificationCenterProvider } from '../components/NotificationCenter';
import { getMeshModelComponentByName } from '../api/meshmodel';
import { CONNECTION_KINDS, CONNECTION_KINDS_DEF, CONNECTION_STATES } from '../utils/Enum';
import CAN, { ability } from '../utils/can';
import { getCredentialByID } from '@/api/credentials';
import { DynamicComponentProvider } from '@/utils/context/dynamicContext';
import { store } from '../store';
import { RTKContext } from '@/store/hooks';
import { formatToTitleCase } from '@/utils/utils';
import { useThemePreference } from '@/themes/hooks';
import {
  ErrorBoundary,
  useTheme,
  SistentThemeProvider,
  CssBaseline,
  Typography,
  Hidden,
  NoSsr,
} from '@layer5/sistent';
import LoadingScreen from '@/components/LoadingComponents/LoadingComponentServer';
import { LoadSessionGuard } from '@/rtk-query/ability';
import { randomLoadingMessage } from '@/components/LoadingComponents/loadingMessages';
import { keys } from '@/utils/permission_constants';
import CustomErrorFallback from '@/components/General/ErrorBoundary';
import {
  StyledAppContent,
  StyledDrawer,
  StyledFooterBody,
  StyledFooterText,
  StyledMainContent,
  StyledContentWrapper,
  StyledRoot,
  ThemeResponsiveSnackbar,
} from '../themes/App.styles';

if (typeof window !== 'undefined') {
  require('codemirror/mode/yaml/yaml');
  require('codemirror/mode/javascript/javascript');
  require('codemirror/addon/lint/lint');
  require('codemirror/addon/lint/yaml-lint');
  require('codemirror/addon/lint/json-lint');
  if (typeof window.jsyaml === 'undefined') {
    window.jsyaml = require('js-yaml');
  }
  if (typeof window.jsonlint === 'undefined') {
    // jsonlint did not work well with codemirror json-lint. Hence, found an alternative (jsonlint-mod) based on https://github.com/scniro/react-codemirror2/issues/21
    window.jsonlint = require('jsonlint-mod');
  }
}

async function fetchContexts(number = 10, search = '') {
  return await promisifiedDataFetch(
    `/api/system/kubernetes/contexts?pagesize=${number}&search=${encodeURIComponent(search)}`,
  );
}

export const mesheryExtensionRoute = '/extension/meshmap';
function isMesheryUiRestrictedAndThePageIsNotPlayground(capabilitiesRegistry) {
  return (
    !window.location.pathname.startsWith(mesheryExtensionRoute) &&
    capabilitiesRegistry?.restrictedAccess?.isMesheryUiRestricted
  );
}

export function isExtensionOpen() {
  return window.location.pathname.startsWith(mesheryExtensionRoute);
}

const Footer = ({ capabilitiesRegistry, handleL5CommunityClick }) => {
  const theme = useTheme();

  const extension = useSelector((state) => {
    return state.get('extensionType');
  });

  if (extension == 'navigator') {
    return null;
  }

  return (
    <StyledFooterBody>
      <Typography
        variant="body2"
        align="center"
        component="p"
        style={{
          color:
            theme.palette.mode === 'light'
              ? theme.palette.text.default
              : theme.palette.text.disabled,
        }}
      >
        <StyledFooterText onClick={handleL5CommunityClick}>
          {capabilitiesRegistry?.restrictedAccess?.isMesheryUiRestricted ? (
            'ACCESS LIMITED IN MESHERY PLAYGROUND. DEPLOY MESHERY TO ACCESS ALL FEATURES.'
          ) : (
            <>
              {' '}
              Built with{' '}
              <FavoriteIcon
                style={{
                  color: theme.palette.background.brand.default,
                  display: 'inline',
                  verticalAlign: 'bottom',
                }}
              />{' '}
              by the Layer5 Community
            </>
          )}
        </StyledFooterText>
      </Typography>
    </StyledFooterBody>
  );
};

const KubernetesSubscription = ({ store, setActiveContexts, setAppState }) => {
  const k8sContextSubscription = (page = '', search = '', pageSize = '10', order = '') => {
    // Don't fetch k8s contexts if user doesn't have permission
    if (!CAN(keys.VIEW_ALL_KUBERNETES_CLUSTERS.action, keys.VIEW_ALL_KUBERNETES_CLUSTERS.subject)) {
      return () => {};
    }

    return subscribeK8sContext(
      (result) => {
        // TODO: Remove local state and only use redux store
        setAppState({ k8sContexts: result.k8sContext }, () => setActiveContexts('all'));
        store.dispatch({
          type: actionTypes.UPDATE_CLUSTER_CONFIG,
          k8sConfig: result.k8sContext.contexts,
        });
      },
      {
        selector: {
          page: page,
          pageSize: pageSize,
          order: order,
          search: search,
        },
      },
    );
  };

  useEffect(() => {
    const disposeK8sContextSubscription = k8sContextSubscription();
    setAppState({ disposeK8sContextSubscription });
    return () => {
      disposeK8sContextSubscription();
    };
  }, []);

  return null;
};

class MesheryApp extends App {
  constructor() {
    super();
    this.pageContext = getPageContext();
    this.eventsSubscriptionRef = React.createRef();
    this.fullScreenChanged = this.fullScreenChanged.bind(this);
    this.state = {
      mobileOpen: false,
      isDrawerCollapsed: false,
      isFullScreenMode: false,
      isLoading: true,
      k8sContexts: [],
      activeK8sContexts: [],
      operatorSubscription: null,
      mesheryControllerSubscription: null,
      disposeK8sContextSubscription: null,
      theme: 'light',
      isOpen: false,
      relayEnvironment: createRelayEnvironment(),
      connectionMetadata: {},
      keys: [],
      abilities: [],
      abilityUpdated: false,
    };
  }

  loadPromGrafanaConnection = () => {
    const { store } = this.props;

    dataFetch(
      `/api/integrations/connections?page=0&pagesize=2&status=${encodeURIComponent(
        JSON.stringify([CONNECTION_STATES.CONNECTED, CONNECTION_STATES.REGISTERED]),
      )}&kind=${encodeURIComponent(
        JSON.stringify([CONNECTION_KINDS.PROMETHEUS, CONNECTION_KINDS.GRAFANA]),
      )}`,
      {
        credentials: 'include',
        method: 'GET',
      },
      (res) => {
        res?.connections?.forEach((connection) => {
          if (connection.kind == CONNECTION_KINDS.PROMETHEUS) {
            const promCfg = {
              prometheusURL: connection?.metadata?.url || '',
              selectedPrometheusBoardsConfigs: connection?.metadata['prometheus_boards'] || [],
              connectionID: connection?.id,
              connectionName: connection?.name,
            };

            store.dispatch({ type: actionTypes.UPDATE_PROMETHEUS_CONFIG, prometheus: promCfg });
          } else {
            const credentialID = connection?.credential_id;

            getCredentialByID(credentialID).then((res) => {
              const grafanaCfg = {
                grafanaURL: connection?.metadata?.url || '',
                grafanaAPIKey: res?.secret?.secret || '',
                grafanaBoardSearch: '',
                grafanaBoards: connection?.metadata['grafana_boards'] || [],
                selectedBoardsConfigs: [],
                connectionID: connection?.id,
                connectionName: connection?.name,
              };
              store.dispatch({ type: actionTypes.UPDATE_GRAFANA_CONFIG, grafana: grafanaCfg });
            });
          }
        });
      },
    );
  };

  fullScreenChanged = () => {
    this.setState((state) => {
      return { isFullScreenMode: !state.isFullScreenMode };
    });
  };

  componentDidMount() {
    this.loadConfigFromServer(); // this works, but sometimes other components which need data load faster than this data is obtained.
    this.loadPromGrafanaConnection();
    this.loadOrg();
    this.initSubscriptions([]);
    dataFetch(
      '/api/user/prefs',
      {
        method: 'GET',
        credentials: 'include',
      },
      (result) => {
        if (typeof result?.usersExtensionPreferences?.catalogContent !== 'undefined') {
          this.props.toggleCatalogContent({
            catalogVisibility: result?.usersExtensionPreferences?.catalogContent,
          });
        }
      },
      (err) => console.error(err),
    );

    document.addEventListener('fullscreenchange', this.fullScreenChanged);
    this.loadMeshModelComponent();
    this.setState({ isLoading: false });
  }

  loadMeshModelComponent = () => {
    const connectionDef = {};
    CONNECTION_KINDS_DEF.map(async (kind) => {
      const res = await getMeshModelComponentByName(formatToTitleCase(kind).concat('Connection'));
      if (res?.components) {
        connectionDef[CONNECTION_KINDS[kind]] = {
          transitions: res?.components[0].metadata.transitions,
          icon: res?.components[0].styles.svgColor,
        };
      }
      this.setState({ connectionMetadata: connectionDef });
    });
    this.props.setConnectionMetadata({
      connectionMetadataState: connectionDef,
    });
  };

  componentWillUnmount() {
    document.removeEventListener('fullscreenchange', this.fullScreenChanged);
  }

  componentDidUpdate(prevProps) {
    const { k8sConfig, capabilitiesRegistry } = this.props;

    // in case the meshery-ui is restricted, the user will be redirected to signup/extension page
    if (isMesheryUiRestrictedAndThePageIsNotPlayground(capabilitiesRegistry)) {
      Router.push(mesheryExtensionRoute);
    }

    if (!_.isEqual(prevProps.k8sConfig, k8sConfig)) {
      const { mesheryControllerSubscription } = this.state;
      console.log(
        'k8sconfig changed, re-initialising subscriptions',
        k8sConfig,
        this.state.activeK8sContexts,
      );
      const ids = getK8sConfigIdsFromK8sConfig(k8sConfig);

      if (mesheryControllerSubscription) {
        mesheryControllerSubscription.updateSubscription(
          getConnectionIDsFromContextIds(ids, k8sConfig),
        );
      }
    }
  }

  initSubscriptions = (contexts) => {
    const connectionIDs = getConnectionIDsFromContextIds(contexts, this.props.k8sConfig);

    // No need to create a controller subscription if there are no connections
    if (connectionIDs.length < 1) {
      this.setState({ mesheryControllerSubscription: () => {} });
      return;
    }

    const mesheryControllerSubscription = new GQLSubscription({
      type: MESHERY_CONTROLLER_SUBSCRIPTION,
      connectionIDs: getConnectionIDsFromContextIds(contexts, this.props.k8sConfig),
      callbackFunction: (data) => {
        this.props.store.dispatch({
          type: actionTypes.SET_CONTROLLER_STATE,
          controllerState: data,
        });
      },
    });

    this.setState({ mesheryControllerSubscription });
  };

  handleDrawerToggle = () => {
    this.setState((state) => ({ mobileOpen: !state.mobileOpen }));
  };

  handleL5CommunityClick = () => {
    this.setState((state) => ({ isOpen: !state.isOpen }));
  };

  /**
   * Sets the selected k8s context on global level.
   * @param {Array.<string>} activeK8sContexts
   */
  activeContextChangeCallback = (activeK8sContexts) => {
    if (activeK8sContexts.includes('all')) {
      activeK8sContexts = ['all'];
    }
    this.props.store.dispatch(setK8sContexts({ selectedK8sContexts: activeK8sContexts }));
  };

  setActiveContexts = (id) => {
    if (this.state.k8sContexts?.contexts) {
      if (id === 'all') {
        let activeContexts = [];
        this.state.k8sContexts.contexts.forEach((ctx) => activeContexts.push(ctx.id));
        activeContexts.push('all');
        this.setState({ activeK8sContexts: activeContexts }, () =>
          this.activeContextChangeCallback(this.state.activeK8sContexts),
        );
        return;
      }

      // if id is an empty array, clear all active contexts
      if (Array.isArray(id) && id.length === 0) {
        this.setState({ activeK8sContexts: [] }, () =>
          this.activeContextChangeCallback(this.state.activeK8sContexts),
        );
        return;
      }

      this.setState(
        (state) => {
          let ids = [...(state.activeK8sContexts || [])];
          //pop event
          if (ids.includes(id)) {
            ids = ids.filter((id) => id !== 'all');
            return { activeK8sContexts: ids.filter((cid) => cid !== id) };
          }

          //push event
          if (ids.length === this.state.k8sContexts.contexts.length - 1) {
            ids.push('all');
          }
          return { activeK8sContexts: [...ids, id] };
        },
        () => this.activeContextChangeCallback(this.state.activeK8sContexts),
      );
    }
  };

  searchContexts = (search = '') => {
    fetchContexts(10, search)
      .then((ctx) => {
        this.setState({ k8sContexts: ctx });
        const active = ctx?.contexts?.find((c) => c.is_current_context === true);
        if (active) this.setState({ activeK8sContexts: [active?.id] });
      })
      .catch((err) => console.error(err));
  };

  updateExtensionType = (type) => {
    this.props.store.dispatch({ type: actionTypes.UPDATE_EXTENSION_TYPE, extensionType: type });
  };

  loadOrg = async () => {
    const currentOrg = sessionStorage.getItem('currentOrg');
    let reFetchKeys = false;

    if (currentOrg && currentOrg !== 'undefined') {
      let org = JSON.parse(currentOrg);
      await this.loadAbility(org.id, reFetchKeys);
      this.setOrganization(org);
      await this.loadWorkspace(org.id);
    }

    dataFetch(
      '/api/identity/orgs',
      {
        method: 'GET',
        credentials: 'include',
      },
      async (result) => {
        let organizationToSet;
        const sessionOrg = JSON.parse(currentOrg);

        if (currentOrg) {
          const indx = result.organizations.findIndex((org) => org.id === sessionOrg.id);
          if (indx === -1) {
            organizationToSet = result.organizations[0];
            reFetchKeys = true;
            await this.loadAbility(organizationToSet.id, reFetchKeys);
            await this.loadWorkspace(organizationToSet.id);
            this.setOrganization(organizationToSet);
          }
        } else {
          organizationToSet = result.organizations[0];
          reFetchKeys = true;
          await this.loadWorkspace(organizationToSet.id);
          await this.loadAbility(organizationToSet.id, reFetchKeys);
          this.setOrganization(organizationToSet);
        }
      },
      (err) => console.log('There was an error fetching available orgs:', err),
    );
  };
  loadWorkspace = async (orgId) => {
    const currentWorkspace = sessionStorage.getItem('currentWorkspace');
    if (currentWorkspace && currentWorkspace !== 'undefined') {
      let workspace = JSON.parse(currentWorkspace);
      this.setWorkspace(workspace);
    } else {
      dataFetch(
        `/api/workspaces?search=&order=&page=0&pagesize=10&orgID=${orgId}`,
        {
          method: 'GET',
          credentials: 'include',
        },
        async (result) => {
          this.setWorkspace(result.workspaces[0]);
        },
        (err) => console.log('There was an error fetching workspaces:', err),
      );
    }
  };
  setOrganization = (org) => {
    const { store } = this.props;
    store.dispatch({
      type: actionTypes.SET_ORGANIZATION,
      organization: org,
    });
  };
  setWorkspace = (workspace) => {
    const { store } = this.props;
    store.dispatch({
      type: actionTypes.SET_WORKSPACE,
      workspace: workspace,
    });
  };
  loadAbility = async (orgID, reFetchKeys) => {
    const storedKeys = sessionStorage.getItem('keys');
    const { store } = this.props;
    if (storedKeys !== null && !reFetchKeys && storedKeys !== 'undefined') {
      this.setState({ keys: JSON.parse(storedKeys) }, this.updateAbility);
    } else {
      dataFetch(
        `/api/identity/orgs/${orgID}/users/keys`,
        {
          method: 'GET',
          credentials: 'include',
        },
        (result) => {
          if (result) {
            this.setState({ keys: result.keys }, () => {
              store.dispatch({
                type: actionTypes.SET_KEYS,
                keys: result.keys,
              });
              this.updateAbility();
            });
          }
        },
        (err) => console.log('There was an error fetching available orgs:', err),
      );
    }
  };

  updateAbility = () => {
    ability.update(
      this.state.keys?.map((key) => ({ action: key.id, subject: _.lowerCase(key.function) })),
    );
    this.setState({ abilityUpdated: true });
  };

  async loadConfigFromServer() {
    const { store } = this.props;
    dataFetch(
      '/api/system/sync',
      {
        method: 'GET',
        credentials: 'include',
      },
      (result) => {
        if (result) {
          if (
            result.meshAdapters &&
            result.meshAdapters !== null &&
            result.meshAdapters.length > 0
          ) {
            store.dispatch({
              type: actionTypes.UPDATE_ADAPTERS_INFO,
              meshAdapters: result.meshAdapters,
            });
          }
          // if (result.grafana) {
          //   const grafanaCfg = Object.assign(
          //     {
          //       grafanaURL: '',
          //       grafanaAPIKey: '',
          //       grafanaBoardSearch: '',
          //       grafanaBoards: [],
          //       selectedBoardsConfigs: [],
          //     },
          //     result.grafana,
          //   );
          //   store.dispatch({ type: actionTypes.UPDATE_GRAFANA_CONFIG, grafana: grafanaCfg });
          // }
          // if (result.prometheus) {
          //   if (typeof result.prometheus.prometheusURL === 'undefined') {
          //     result.prometheus.prometheusURL = '';
          //   }
          //   if (typeof result.prometheus.selectedPrometheusBoardsConfigs === 'undefined') {
          //     result.prometheus.selectedPrometheusBoardsConfigs = [];
          //   }
          //   const promCfg = Object.assign(
          //     {
          //       prometheusURL: '',
          //       selectedPrometheusBoardsConfigs: [],
          //     },
          //     result.prometheus,
          //   );
          //   store.dispatch({ type: actionTypes.UPDATE_PROMETHEUS_CONFIG, prometheus: promCfg });
          // }
          if (result.loadTestPrefs) {
            const loadTestPref = Object.assign(
              {
                c: 0,
                qps: 0,
                t: 0,
                gen: 0,
              },
              result.loadTestPrefs,
            );
            store.dispatch({ type: actionTypes.UPDATE_LOAD_GEN_CONFIG, loadTestPref });
          }
          if (typeof result.anonymousUsageStats !== 'undefined') {
            store.dispatch({
              type: actionTypes.UPDATE_ANONYMOUS_USAGE_STATS,
              anonymousUsageStats: result.anonymousUsageStats,
            });
          }
          if (typeof result.anonymousPerfResults !== 'undefined') {
            store.dispatch({
              type: actionTypes.UPDATE_ANONYMOUS_PERFORMANCE_RESULTS,
              anonymousPerfResults: result.anonymousPerfResults,
            });
          }
        }
      },
      (error) => {
        console.log(`there was an error fetching user config data: ${error}`);
      },
    );
  }

  static async getInitialProps({ Component, ctx }) {
    const pageProps = Component.getInitialProps ? await Component.getInitialProps(ctx) : {};
    return { pageProps };
  }

  themeSetter = () => {
    console.log('using theme setter is no longer supported');
    // this.setState({ theme: thememode });
  };

  setAppState(partialState, callback) {
    return this.setState(partialState, callback);
  }

  render() {
    const { Component, pageProps, isDrawerCollapsed, relayEnvironment } = this.props;
    const setAppState = this.setAppState.bind(this);
    const canShowNav = !this.state.isFullScreenMode && uiConfig?.components?.navigator !== false;

    return (
      <LoadingScreen message={randomLoadingMessage} isLoading={this.state.isLoading}>
        <DynamicComponentProvider>
          <RelayEnvironmentProvider environment={relayEnvironment}>
            <MesheryThemeProvider>
              <NoSsr>
                <ErrorBoundary customFallback={CustomErrorFallback}>
                  <LoadSessionGuard>
                    <StyledRoot>
                      <CssBaseline />
                      <NavigationBar
                        isDrawerCollapsed={isDrawerCollapsed}
                        mobileOpen={this.state.mobileOpen}
                        handleDrawerToggle={this.handleDrawerToggle}
                        handleCollapseDrawer={this.handleCollapseDrawer}
                        updateExtensionType={this.updateExtensionType}
                        canShowNav={canShowNav}
                      />
                      <StyledAppContent canShowNav={canShowNav}>
                        <SnackbarProvider
                          anchorOrigin={{
                            vertical: 'bottom',
                            horizontal: 'right',
                          }}
                          iconVariant={{
                            success: <CheckCircle style={{ marginRight: '0.5rem' }} />,
                            error: <Error style={{ marginRight: '0.5rem' }} />,
                            warning: <Warning style={{ marginRight: '0.5rem' }} />,
                            info: <Info style={{ marginRight: '0.5rem' }} />,
                          }}
                          Components={{
                            info: ThemeResponsiveSnackbar,
                            success: ThemeResponsiveSnackbar,
                            error: ThemeResponsiveSnackbar,
                            warning: ThemeResponsiveSnackbar,
                            loading: ThemeResponsiveSnackbar,
                          }}
                          maxSnack={10}
                        >
                          <NotificationCenterProvider>
                            <MesheryProgressBar />
                            <KubernetesSubscription
                              store={this.props.store}
                              setActiveContexts={this.setActiveContexts}
                              setAppState={setAppState}
                            />
                            {!this.state.isFullScreenMode && (
                              <Header
                                onDrawerToggle={this.handleDrawerToggle}
                                onDrawerCollapse={isDrawerCollapsed}
                                contexts={this.state.k8sContexts}
                                activeContexts={this.state.activeK8sContexts}
                                setActiveContexts={this.setActiveContexts}
                                searchContexts={this.searchContexts}
                                updateExtensionType={this.updateExtensionType}
                                abilityUpdated={this.state.abilityUpdated}
                              />
                            )}
                            <StyledContentWrapper>
                              <StyledMainContent
                                style={{
                                  padding: this.props.extensionType === 'navigator' && '0px',
                                }}
                              >
                                <LocalizationProvider dateAdapter={AdapterMoment}>
                                  <ErrorBoundary customFallback={CustomErrorFallback}>
                                    <Component
                                      pageContext={this.pageContext}
                                      contexts={this.state.k8sContexts}
                                      activeContexts={this.state.activeK8sContexts}
                                      setActiveContexts={this.setActiveContexts}
                                      searchContexts={this.searchContexts}
                                      {...pageProps}
                                    />
                                  </ErrorBoundary>
                                </LocalizationProvider>
                              </StyledMainContent>
                              <Footer
                                handleL5CommunityClick={this.handleL5CommunityClick}
                                capabilitiesRegistry={this.props.capabilitiesRegistry}
                              />
                            </StyledContentWrapper>
                          </NotificationCenterProvider>
                        </SnackbarProvider>
                      </StyledAppContent>
                    </StyledRoot>
                    <PlaygroundMeshDeploy
                      closeForm={() => this.setState({ isOpen: false })}
                      isOpen={this.state.isOpen}
                    />
                  </LoadSessionGuard>
                </ErrorBoundary>
              </NoSsr>
            </MesheryThemeProvider>
          </RelayEnvironmentProvider>
        </DynamicComponentProvider>
      </LoadingScreen>
    );
  }
}

const mapStateToProps = (state) => ({
  isDrawerCollapsed: state.get('isDrawerCollapsed'),
  k8sConfig: state.get('k8sConfig'),
  operatorSubscription: state.get('operatorSubscription'),
  capabilitiesRegistry: state.get('capabilitiesRegistry'),
  telemetryURLs: state.get('telemetryURLs'),
  connectionMetadata: state.get('connectionMetadata'),
  extensionType: state.get('extensionType'),
  organization: state.get('organization'),
});

const mapDispatchToProps = (dispatch) => ({
  toggleCatalogContent: bindActionCreators(toggleCatalogContent, dispatch),
  updateTelemetryUrls: bindActionCreators(updateTelemetryUrls, dispatch),
  setConnectionMetadata: bindActionCreators(setConnectionMetadata, dispatch),
});

const MesheryWithRedux = connect(mapStateToProps, mapDispatchToProps)(MesheryApp);

const MesheryThemeProvider = ({ children }) => {
  const themePref = useThemePreference();
  const mode = themePref?.data?.mode || 'dark';
  return <SistentThemeProvider initialMode={mode}>{children}</SistentThemeProvider>;
};

const MesheryAppWrapper = (props) => {
  return (
    <Provider store={store} context={RTKContext}>
      <Provider store={props.store} context={LegacyStoreContext}>
        <Provider store={props.store}>
          <Head>
            <link rel="shortcut icon" href="/static/img/meshery-logo/meshery-logo.svg" />
            <title>Meshery</title>
          </Head>
          <LocalizationProvider dateAdapter={AdapterMoment}>
            <MesheryWithRedux {...props} />
          </LocalizationProvider>
        </Provider>
      </Provider>
    </Provider>
  );
};

export default withRedux(makeStore, {
  serializeState: (state) => state.toJS(),
  deserializeState: (state) => fromJS(state),
})(MesheryAppWrapper);

const NavigationBar = ({
  isDrawerCollapsed,
  mobileOpen,
  handleDrawerToggle,
  handleCollapseDrawer,
  updateExtensionType,
  canShowNav,
}) => {
  if (!canShowNav) {
    return null;
  }

  return (
    <StyledDrawer
      isDrawerCollapsed={isDrawerCollapsed}
      data-testid="navigation"
      id="left-navigation-bar"
    >
      <Hidden smUp implementation="js">
        <Navigator
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          onCollapseDrawer={(open = null) => handleCollapseDrawer(open)}
          isDrawerCollapsed={isDrawerCollapsed}
          updateExtensionType={updateExtensionType}
        />
      </Hidden>
      <Hidden xsDown implementation="css">
        <Navigator
          onCollapseDrawer={(open = null) => handleCollapseDrawer(open)}
          isDrawerCollapsed={isDrawerCollapsed}
          updateExtensionType={updateExtensionType}
        />
      </Hidden>
    </StyledDrawer>
  );
};
