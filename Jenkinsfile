pipeline {
  agent { label 'local-docker' }
  options {
    timestamps()
    disableConcurrentBuilds()
    skipDefaultCheckout(true)
    timeout(time: 60, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }
  triggers { githubPush() }
  environment {
    DEPLOY_ENV_SOURCE = '/var/lib/jenkins/secrets/pcp-deploy.env'
    DEPLOY_ENV = '.env.deploy'
    BACKUP_DIR = '/var/lib/jenkins/backups/personal-context-protocol'
    COMPOSE_PROJECT_NAME = 'personal-context-protocol'
    COMPOSE_PARALLEL_LIMIT = '1'
    BUILDX_BUILDER = 'pcp-jenkins'
    NO_PROXY = 'localhost,127.0.0.1,::1'
    no_proxy = 'localhost,127.0.0.1,::1'
  }
  stages {
    stage('Checkout GitHub main') {
      steps {
        deleteDir()
        script {
          def revision = checkout scm
          env.GIT_COMMIT = revision.GIT_COMMIT
        }
      }
    }
    stage('Prepare private environment') {
      steps { sh 'python3 deploy/jenkins/prepare_env.py "$DEPLOY_ENV_SOURCE" "$WORKSPACE/$DEPLOY_ENV"' }
    }
    stage('Build, typecheck and test') {
      steps { sh 'bash deploy/jenkins/build_test.sh "$WORKSPACE/$DEPLOY_ENV"' }
    }
    stage('Database tests') {
      steps { sh 'timeout 15m bash deploy/jenkins/db_test.sh' }
    }
    stage('Plugin tests') {
      steps { sh 'timeout 10m bash deploy/jenkins/thirdparty_test.sh' }
    }
    stage('Deploy guard tests') {
      steps { sh 'timeout 5m bash deploy/jenkins/test_check_storage.sh' }
    }
    stage('Database backup') {
      steps { sh 'timeout 5m bash deploy/jenkins/backup_database.sh "$BACKUP_DIR"' }
    }
    stage('Deploy full stack') {
      steps { sh 'bash deploy/jenkins/deploy.sh "$WORKSPACE/$DEPLOY_ENV"' }
    }
    stage('Sync channel plugins') {
      // Each step is a no-op unless the plugin changed; on change it backs up,
      // installs, restarts and verifies health and channels, else restores.
      steps {
        sh 'timeout 10m bash deploy/plugins/sync_openclaw_pcp.sh'
        sh 'timeout 10m bash deploy/plugins/sync_astrbot_relay.sh'
      }
    }
  }
  post {
    always {
      junit testResults: 'reports/*.xml', allowEmptyResults: true
      sh 'rm -f "$WORKSPACE/$DEPLOY_ENV"'
    }
    success { echo 'Deployment verified: PCP.Jenkins/complete — remote source tests, database backup, version and database checks passed.' }
    failure { echo 'Deployment incomplete: PCP.Jenkins/pipeline — required stage failed; inspect the retained build log before retrying.' }
  }
}
