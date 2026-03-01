---
title: Jervis YAML Options
weight: 10
---
# Full YAML Options

At IAS, `.jervis.yml` dictates the toolchains which get set up every time you
call `runToolChainsSh` in your `.ci/Jenkinsfile`.  For the source code ran by
toolchains [refer to `toolchains-*` files located in
`resources/com/integralads`][toolchains-src].

High level here's every possible option you could specify in your `.jervis.yml`.
Some keys say [see lifecycles document](lifecycles.md).

Operating systems and platforms support comes from [platforms.yaml][platforms].

## All YAML Options

```yaml
# LIFECYCLES
language: [go, groovy, java, node_js, python, ruby, scala, shell] # see lifecycles document
install: # see lifecycles document
script: # see lifecycles document

# TOOLCHAINS
agent_custom_setup: |
  echo shell code to set up your agent on every runToolChainsSh call
bun: '1.3.6' # `bun` JavaScript runtime from https://github.com/oven-sh/bun/releases
databricks-cli: 0.242.0 # `databricks` CLI from https://github.com/databricks/cli/releases
dbx-cli: enabled # For Databricks deployments; Installs a centrally controled version of `dbx` utility
# one of:
docker: [enabled, disabled] # Start Docker daemon on agent for building Docker images; default 'disabled'
env: # see documentation at https://github.com/samrocketman/jervis/wiki/Matrix-job-support#environment-matrix
gem:
  - 'rails:0.14.4' # a list of Ruby gems to install via `gem install` for Ruby language
gemfile: Gemfile # sets BUNDLE_GEMFILE environment variable
go: '1.24.0' # `go` version for Go language
go_import_path: # don't bother customizing this
# one of
jdk: [corretto11, corretto17, corretto21, corretto24, corretto25, graalvm21ce, graalvm24ce] # `java` version for Java language
node_js: '22.14.0' # `node` version for NodeJS language
# one of
python: ['3.6', '3.8', '3.9', '3.10', '3.11', '3.12', '3.13'] # `python` version for Python language
rvm: 3.4.2 # `ruby` version for Ruby language
sbt: 1.5.5 # `sbt` version for Scala language
scala: 2.13.6 # `scala` version for Scala language
# additional_toolchains  will "auto-add" more toolchains to your agent setup as
# well as allow you to control the load order.
additional_toolchains:
  - agent_custom_setup
  - bun
  - databricks-cli
  - docker
  - docker-compose
  - env
  - gem
  - gemfile
  - go_import_path
  - go
  - gradle
  - groovy
  - jdk
  - node_js
  - pact_protobuf_plugin
  - python
  - rvm
  - sbt
  - scala
  - sdkman-install
  - yq

# deprecated toolchains (not recommended for use)
docker-compose: # install version from https://github.com/docker/compose/releases
sdkman-install: ['true', 'false'] # if String 'true' sets up sdkman
yq: ['2', '3', '4', or specific version] # install your own yq version
groovy: # `groovy` version for Groovy language; use gradle wrapper, instead
gradle: # `gradle` version for Gradle language; use gradle wrapper, instead
# Note: Maven can't be customized; use Maven wrapper, instead

# BUILD FILTERING
# see https://plugins.jenkins.io/scm-filter-jervis/
branches: # filters by Git branch names
  # disallow list
  except:
    - legacy
    - experimental
  # allow list
  only:
    - master
    - '/*-hotfix/'
tags: # filters by Git tag names
  # disallow list
  except:
    - /.*-rc/
    - /.*-beta/
  # allow list
  only:
    - /v[.0-9]+/

# JENKINS CUSTOMIZATION
jenkins:
  platform: [arm64, x86_64] # pick your CPU architecture; x86_64 is default
  os: [amazonlinux2, amazonlinux2023] # use amazonlinux2023; AL2 is going away
  pipeline_jenkinsfile: .ci/Jenkinsfile # path to your user-controlled Jenkinsfile
  provision_compute: [small, medium, large] # medium default; please do not use large unless you check in #cicd-jenkins-ng slack channel first.
  agent: # not currently used; we used to use this to single out Mac OSX agents when we had static agents
  agent_version: # see https://ias-backstage.303net.net/docs/default/Component/re-documentation/jenkins-ng/operating-systems/#testing-custom-agents
  # We auto-kill older builds for all pipelines on the fly to save on cost and performance.
  kill_old_jobs: [true, false] # default true; if you don't want old builds to be auto-killed then you must set this to `false` to stop it
  notify_on_error: '#slack-channel' # see also notify_slack step in references

# JENKINS AGENT HOST CUSTOMIZATION
jenkins-agent:
  # Expose services hosted within your Jenkins agent so that external services
  # such as BrowserStack can hit up against your service within Jenkins pipeline
  # directly.  You can use $AGENT_PRIVATE_HOSTNAME and $AGENT_PRIVATE_IP
  # environment variables to orchestrate the inbound communication.  firewall-js
  # is an example of using this feature thoroughly.
  docker-expose:
    - '3000:3000' # A list of ports you want exposed on the agent host
  # you don't need the following setting if you use docker-expose
  # users probably don't ever need to set this but documenting anyways
  imds-host: true # force-resolve instance metadata service host; affects AGENT_* environment variables
  # docker-hosts remaps hostnames via /etc/hosts on the agent
  # Domain names (such as ALBs) will have a dig performed to identify current IP.
  # choose one of
  docker-hosts: <string, list of strings, map of key:value pairs>
  # String example
  #   docker-hosts: 'somehost=1.2.3.4'
  # List example
  #   docker-hosts:
  #     - 'example.com=my.alb.dnsname'
  #     - 'somehost=1.2.3.4'
  # Map example
  #   docker-hosts:
  #     example.com: 'my.alb.dnsname'
  #     somehost: '1.2.3.4'



# GITHUB CUSTOMIZATION
# customize required checks before being allowed to merge
# these checks are in addition to the pr-head requirement
# Note: users can change code vote back a fake stage passing a check.
# Be vigilant in reviews if you really need this setting.
# This may be organized under `github:` key in the future.
required_checks:
  - Your Jenkins Stage Name or Unit Test
# Allow other projects to use Jenkinsfile to force merge pull requests into your
# current project using `openAndMergePullRequest` step.
github:
  allow_force_merge_from: # can provide multiple projects allowed to force-merge
    - docker-jenkins-agent # project name at https://github.com/integralads/ org
  stage_names_to_skip_pr_status:
    - 'If your stage name starts with this, then skip writing PR status'
```

Foot notes:

> ‌‌‌‌‌‌- See [notify_slack](../steps/reference/notify_slack.md#notify-any-failure-from-jervis-yaml) step for alternate `notify_on_error` syntax.
> - `openAndMergePullRequest` will automatically make changes to downstream
> projects.  You don't need to manually add `github.allow_force_merge_from`
> in your `.jervis.yml`.
> - Avoid customizing `go_import_path`.
> - `sdkman-install` is not recommended because it isn't possible for us to proxy
> installed artifacts through Nexus.  This was reported upstream and the sdkman
> developers rejected the idea of a corporate artifact mirror as a feature.
> - Deprecated toolchains are being considered for removal in the future but
> currently there's no nearterm plans to remove the functionality.
> - If you don't specify a version for an implied toolchain,  then you'll be at
> the mercy of us upgrading the default versions for a given toolchain.  We plan
> to start more regularly updating the default versions specified in [toolchains
> yaml][al2023-toolchains].
> - `docker-hosts` will not work on compliance stages
> - [deployStage option etc_hosts](../steps/deployStage.md) is the same as `docker-hosts` but on an individual agent instead of the entire pipeline.
>
> ‍‍‍‍‍‍

[al2023-toolchains]: https://github.com/integralads/jenkins-pipeline-scripts/blob/master/resources/com/integralads/toolchains-amazonlinux2023-stable.yaml
[platforms]: https://github.com/integralads/jenkins-pipeline-scripts/blob/master/resources/com/integralads/platforms.yaml
[toolchains-src]: https://github.com/integralads/jenkins-pipeline-scripts/tree/master/resources/com/integralads
