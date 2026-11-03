"""Configure PCP's existing Jenkins job to load GitHub main through SCM.

Set JENKINS_PASSWORD in the host environment. Private runtime env is not copied
by this helper; install it separately inside the local-docker build agent.
"""
import base64
import http.cookiejar
import json
import os
from pathlib import Path
import urllib.request
import xml.etree.ElementTree as ET

base = os.environ.get('JENKINS_URL', 'http://127.0.0.1:8081/').rstrip('/') + '/'
username = os.environ.get('JENKINS_USER', 'admin')
headers = {'Authorization': 'Basic ' + base64.b64encode(
    (username + ':' + os.environ['JENKINS_PASSWORD']).encode()).decode()}
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def request(path, data=None):
    h = dict(headers)
    if data is not None:
        h['Content-Type'] = 'application/xml'
    with opener.open(urllib.request.Request(base + path, data=data, headers=h), timeout=30) as response:
        return response.read()


crumb = json.loads(request('crumbIssuer/api/json'))
headers[crumb['crumbRequestField']] = crumb['crumb']
job = 'job/personal-context-protocol/'
raw = request(job + 'config.xml')
backup = Path('logs/jenkins-job-before-scm.xml')
backup.parent.mkdir(exist_ok=True)
if not backup.exists():
    backup.write_bytes(raw)
    backup.chmod(0o600)
root = ET.fromstring(raw)
root.remove(root.find('definition'))
definition = ET.SubElement(root, 'definition', {'class': 'org.jenkinsci.plugins.workflow.cps.CpsScmFlowDefinition'})
scm = ET.SubElement(definition, 'scm', {'class': 'hudson.plugins.git.GitSCM'})
ET.SubElement(scm, 'configVersion').text = '2'
remote = ET.SubElement(ET.SubElement(scm, 'userRemoteConfigs'), 'hudson.plugins.git.UserRemoteConfig')
ET.SubElement(remote, 'url').text = 'https://github.com/Trance-0/personal-context-protocol.git'
branch = ET.SubElement(ET.SubElement(scm, 'branches'), 'hudson.plugins.git.BranchSpec')
ET.SubElement(branch, 'name').text = '*/main'
ET.SubElement(scm, 'doGenerateSubmoduleConfigurations').text = 'false'
ET.SubElement(scm, 'submoduleCfg', {'class': 'empty-list'})
ET.SubElement(scm, 'extensions')
ET.SubElement(definition, 'scriptPath').text = 'Jenkinsfile'
ET.SubElement(definition, 'lightweight').text = 'false'
properties = root.find('properties')
if properties is None:
    properties = ET.SubElement(root, 'properties')
trigger_prop = properties.find('org.jenkinsci.plugins.workflow.job.properties.PipelineTriggersJobProperty')
if trigger_prop is None:
    trigger_prop = ET.SubElement(properties, 'org.jenkinsci.plugins.workflow.job.properties.PipelineTriggersJobProperty')
triggers = trigger_prop.find('triggers')
if triggers is None:
    triggers = ET.SubElement(trigger_prop, 'triggers')
if triggers.find('com.cloudbees.jenkins.GitHubPushTrigger') is None:
    ET.SubElement(ET.SubElement(triggers, 'com.cloudbees.jenkins.GitHubPushTrigger'), 'spec')
root.find('description').text = 'GitHub main webhook → bounded build/tests → PostgreSQL backup → versioned full-stack local deployment. Neon data imported locally; runtime env is private on local-docker.'
request(job + 'config.xml', ET.tostring(root))
installed = ET.fromstring(request(job + 'config.xml'))
assert installed.find('definition').get('class').endswith('CpsScmFlowDefinition')
print('Job configured: PCP.Jenkins/scm — remote GitHub main and Jenkinsfile; existing enabled/disabled state retained')
