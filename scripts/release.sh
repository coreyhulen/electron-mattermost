#!/usr/bin/env bash

# exit when any command fails
set -e

function print_error {
    echo -e "[ERROR  ] $*"
}
function print_warning {
    echo -e "[WARNING] $*"
}
function print_info {
    echo -e "[INFO   ] $*"
}

function tag {
    # not forcing tags, this might fail on purpose if tags are already created 
    # as we don't want to overwrite automatically.
    # if this happens, you should check that versions are ok and see if there are
    # any tags locally or upstream that might conflict.
    git tag -a "v${1}" -m "Desktop Version ${2}"
}

function write_package_version {
    temp_file="$(mktemp -t package.json)"
    jq ".version = \"${1}\"" ./package.json > "${temp_file}" && mv "${temp_file}" ./package.json
    temp_file="$(mktemp -t package-lock.json)"
    jq ".version = \"${1}\"" ./package-lock.json > "${temp_file}" && mv "${temp_file}" ./package-lock.json
    
    git add ./package.json ./package-lock.json
    git commit -qm "Bump to version ${1}"
}


# keep track of the last executed command
# src.: https://stackoverflow.com/a/6110446/3514658
trap 'last_command=$current_command; current_command=$BASH_COMMAND' DEBUG
# echo an error message before exiting
trap 'echo "\"${last_command}\" command filed with exit code $?."' EXIT

# mattermost repo might not be the origin one, we don't want to enforce that.
org="github.com:mattermost"
git_origin="$(git remote -v | grep ${org} | grep push | awk '{print $1}')"
if [[ -z "${git_origin}" ]]; then
    print_warning "Can't find a mattermost remote, defaulting to origin"
    git_origin="origin"
fi

# get original git branch
branch_name="$(git symbolic-ref -q HEAD)"
branch_name="${branch_name##refs/heads/}"
branch_name="${branch_name:-HEAD}"

# don't run if branch is dirty, releases shouldn't be done on a dirty branch
dirty="$(git diff --quiet && echo 0 || echo 1)"
if (( dirty == 1 )); then
    print_error "Please use this script on a clean branch"
    exit 10
fi

# require jq
if ! type jq >/dev/null 2>&1; then
    print_error "This script requires jq to run"
    exit 11
fi

# get version
pkg_version="$(jq -r .version package.json)"
# remove trailing
current_version="${pkg_version%-develop}"
current_version="${pkg_version%-rc*}"
# parse version
IFS='.' read -r major minor micro <<<"${current_version}"
case "${1}" in
    "help")
        echo "todo"
    ;;
    "rc")
        if [[ "${branch_name}" =~ "release-" ]]; then
            if [[ "${pkg_version}" =~ "-rc" ]]; then
                rc="${pkg_version#*-rc}"
            else
                print_warning "No release candidate on the version, assuming 1"
                rc=1
            fi
            case "${rc}" in
                ''|*[!0-9]*) 
                    print_warning "Can't guess release candidate from version, assuming 1"
                    rc=1
                ;;
                *)
                    rc=$(( rc + 1 ))
                ;;
            esac
            print_info "Generating ${current_version} release candidate ${rc}"
            new_pkg_version="${current_version}-rc${rc}"
            write_package_version "${new_pkg_version}"
            tag "${new_pkg_version}" "Release candidate ${rc}"
            print_info "Locally created an rc. In order to build you'll have to:"
            print_info "$ git push --follow-tags ${git_origin} ${branch_name}:${branch_name}"
        else
            print_error "Can't generate a release candidate on a non release-X.Y branch"
            exit 2

        fi
    ;;
    "final")
        if [[ "${branch_name}" =~ "release-" ]]; then
            print_info "Releasing v${current_version}"
            new_pkg_version="${current_version}"
            write_package_version "${new_pkg_version}"
            tag "${new_pkg_version}" "Released on $(date -u)"
            print_info "Locally created an final version. In order to build you'll have to:"
            print_info "$ git push --follow-tags ${git_origin} ${branch_name}:${branch_name}"
            print_info "--------\n"
            print_info "  == AFTER RELEASE FINISHES == "
            print_info "once the release is created you'll need to go to latest/.gitlab-ci.yml"
            print_info "and update the latest version variables for the desktop,"
            print_info "run the the pipeline and from the list of jobs run the desktop one"
        else
            print_error "Can't release on a non release-X.Y branch"
            exit 2
        fi
    ;;
    "patch")
        if [[ "${branch_name}" =~ "release-" ]]; then
            new_pkg_version="${major}.${minor}.$(( micro + 1 ))-rc1"
            print_info "Releasing v${new_pkg_version}"
            write_package_version "${new_pkg_version}"
            tag "${new_pkg_version}" "Released on $(date -u)"
            print_info "Locally created an patch version. In order to build you'll have to:"
            print_info "$ git push --follow-tags ${git_origin} ${branch_name}:${branch_name}"
        else
            print_error "Can't patch on a non release-X.Y branch"
            exit 2
        fi
    ;;
    "branch")
        # Quality releases should run from a release branch
        if [[ "${branch_name}" =~ "release-" ]]; then
            new_branch_version="${major}.$(( minor + 1 ))"
            new_branch_name="release-${new_branch_version}"
            print_info "Doing a quality branch: ${new_branch_name}"

            if git show-ref --verify --quiet "refs/heads/${new_branch_name}"; then
                print_error "Branch ${new_branch_name} exists"
                exit 3
            fi

            new_pkg_version="${new_branch_version}.0-rc1"
            git checkout -b "${new_branch_name}"
            write_package_version "${new_pkg_version}"
            tag "${new_pkg_version}" "Quality branch"
            print_info "Locally created quality branch. In order to build you'll have to:"
            print_info "$ git push --follow-tags ${git_origin} ${new_branch_name}:${new_branch_name}"

        else
            if [[ "${branch_name}" != "master" ]]; then
                print_warning "You are branching on ${branch_name} instead of master or a release-branch"
                read -p "Do you wish to continue? [y/n]" -n 1 -r
                if [[ ! "${REPLY}" =~ ^[Yy]$ ]]; then
                    exit 1
                fi
            fi
            new_branch_version="${major}.${minor}"
            new_branch_name="release-${new_branch_version}"
            new_pkg_version="${new_branch_version}.0-rc1"
            master_pkg_version="${major}.$(( minor + 1 )).0-develop"
            print_info "Creating a new features branch: ${new_branch_name}"

            if git show-ref --verify --quiet "refs/heads/${new_branch_name}"; then
                print_error "Branch ${new_branch_name} exists"
                exit 3
            fi

            git branch "${new_branch_name}"
            print_info "Writing new package version for development: ${master_pkg_version}"
            write_package_version "${master_pkg_version}"
            git checkout "${new_branch_name}"
            write_package_version "${new_pkg_version}"
            tag "${new_pkg_version}" "New features branch"
            print_info "Locally created new features branch. In order to build you'll have to:"
            print_info "$ git push --follow-tags ${git_origin} ${new_branch_name}:${new_branch_name}"
            print_info "For writing master changes you'll need to:"
            print_info "$ git push ${git_origin} ${branch_name}:${branch_name}"
        fi
    ;;
    *)
        print_error "Only branch|rc|final parameters are accepted"
        exit 1
    ;;
esac

trap - EXIT

