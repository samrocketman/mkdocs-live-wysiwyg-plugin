---
title: Example WYSIWYG site
---
# Welcome

- foo
- bar

  > abc

  bar
- baz

This is a test page for the mkdocs-live-wysiwyg-plugin.

```yaml title="Preview Example"
build: techdocs-preview.sh build # (1)
preview: techdocs-preview.sh # (2)
  bar: baz
  build
```

Another item

1. Foo

   ```
   some code
   ```

   1. Build the `site`.

      ```
      text content
      ```

      test
   2. Another
2. Launch a server on `http://127.0.0.1:8000/`.

This code block is 4-space indented.

    ls -a
    echo hello

Click **Edit** above to try the WYSIWYG editor.

## Checklist Support

The WYSIWYG editor supports markdown checklists (task lists). In Markdown mode, use:

- [ ] Unchecked item
- [x] Checked item
- [ ] Another unchecked item

In WYSIWYG mode, click a checkbox to toggle it. Press Enter in a checklist item to create a new empty checklist item (`- [ ]`).

## Admonition Support

The WYSIWYG editor supports MkDocs admonitions. In Markdown mode, use:

!!! note
    This is a note admonition.
    - [ ] Item 1
    - [x] Item 2

Another

!!! warning "Custom Title"
    Admonitions with custom titles work too.

This shows you what it's like to be awesome!

# Test

!!! danger
    This is a note common in mkdocs.

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
uv: latest # `uv` (Python package installer/resolver); add via additional_toolchains. Not a language. From https://github.com/astral-sh/uv
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
  - uv
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
  delete_git_clone: true # deletes the Git clone when agent is complete

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
