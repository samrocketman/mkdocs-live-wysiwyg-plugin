IMAGE_NAME := mkdocs-wysiwyg-vsx-builder
VERSION    := $(shell grep '^version' ../pyproject.toml | head -1 | sed 's/.*"\(.*\)"/\1/')
REPO       ?= samrocketman/mkdocs-live-wysiwyg-plugin
TAG        ?= v$(VERSION)

.PHONY: build icon clean shell pre-build publish-github publish-marketplace publish-openvsx publish-all

icon: resources/icon.png

resources/icon.png: resources/icon.svg
	docker run --rm -v $(CURDIR)/resources:/resources debian:bookworm-slim \
	  sh -c 'apt-get update -qq && apt-get install -y -qq librsvg2-bin >/dev/null 2>&1 && \
	    rsvg-convert -w 128 -h 128 /resources/icon.svg -o /resources/icon.png'

pre-build: icon
	cp ../.github/download-utilities.yml resources/download-utilities.yml
	cp ../README.md README.md
	rm -rf resources/example-docs
	cp -r ../example-docs resources/example-docs
	rm -rf resources/example-docs/site

build: pre-build
	docker build --build-arg VSIX_VERSION=$(VERSION) -t $(IMAGE_NAME) .
	@mkdir -p dist
	docker create --name vsx-extract $(IMAGE_NAME) true
	docker cp vsx-extract:/out/. dist/
	docker rm vsx-extract
	@echo "VSIX built: dist/"
	@ls dist/*.vsix

clean:
	rm -rf dist/ resources/icon.png resources/download-utilities.yml resources/example-docs README.md

shell:
	docker run --rm -it $(IMAGE_NAME) /bin/bash

publish-github:
	docker run --rm -v $(CURDIR)/dist:/dist \
	  -e GITHUB_TOKEN=$(GITHUB_TOKEN) \
	  $(IMAGE_NAME) sh -c ' \
	    gh release create $(TAG) /dist/*.vsix \
	      --repo $(REPO) \
	      --title "$(TAG)" \
	      --generate-notes \
	      --verify-tag \
	    || gh release upload $(TAG) /dist/*.vsix --repo $(REPO) --clobber'

publish-marketplace:
	docker run --rm -v $(CURDIR)/dist:/dist $(IMAGE_NAME) \
	  vsce publish --packagePath /dist/*.vsix --pat $(VSCE_PAT)

publish-openvsx:
	docker run --rm -v $(CURDIR)/dist:/dist $(IMAGE_NAME) \
	  ovsx publish /dist/*.vsix -p $(OVSX_PAT)

publish-all: publish-github publish-marketplace publish-openvsx
