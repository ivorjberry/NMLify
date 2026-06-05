import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import xmltodict
import pytest
from collection_utils import (
    load_collection,
    verify_collection_file,
    clean_location,
    write_nml_playlist,
)


TESTFILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'testfiles', 'collection.nml')


class TestLoadCollection:
    def test_loads_entries(self):
        entries = load_collection(TESTFILE)
        assert isinstance(entries, list)
        assert len(entries) > 0

    def test_entries_have_required_fields(self):
        entries = load_collection(TESTFILE)
        first = entries[0]
        assert '@TITLE' in first
        assert '@ARTIST' in first or '@TITLE' in first  # artist can be missing
        assert 'LOCATION' in first

    def test_single_entry_returns_list(self, tmp_path):
        # xmltodict returns a dict (not a list) for collections with one ENTRY.
        # load_collection should normalize it to a list so callers can iterate.
        nml = tmp_path / "one.nml"
        nml.write_text(
            "<NML><COLLECTION ENTRIES=\"1\">"
            "<ENTRY TITLE=\"Solo\" ARTIST=\"Only One\">"
            "<LOCATION DIR=\"/:Music/:\" FILE=\"solo.mp3\" VOLUME=\"D:\"/>"
            "</ENTRY></COLLECTION></NML>",
            encoding="utf-8",
        )
        entries = load_collection(str(nml))
        assert isinstance(entries, list)
        assert len(entries) == 1
        assert entries[0]['@TITLE'] == 'Solo'

    def test_empty_collection_returns_empty_list(self, tmp_path):
        nml = tmp_path / "empty.nml"
        nml.write_text("<NML><COLLECTION ENTRIES=\"0\"/></NML>", encoding="utf-8")
        entries = load_collection(str(nml))
        assert entries == []

    def test_missing_collection_returns_empty_list(self, tmp_path):
        nml = tmp_path / "noc.nml"
        nml.write_text("<NML><HEAD COMPANY=\"x\" PROGRAM=\"y\"/></NML>", encoding="utf-8")
        entries = load_collection(str(nml))
        assert entries == []


class TestVerifyCollectionFile:
    def test_valid_nml(self):
        result = verify_collection_file('collection.nml')
        assert 'Success' in result

    def test_invalid_extension(self):
        result = verify_collection_file('collection.xml')
        assert 'Error' in result

    def test_empty(self):
        result = verify_collection_file('')
        assert 'Error' in result

    def test_none(self):
        result = verify_collection_file(None)
        assert 'Error' in result


class TestCleanLocation:
    def test_strips_whitespace(self):
        assert clean_location('  /path/to/file  ') == '\\path\\to\\file'

    def test_replaces_slashes(self):
        assert clean_location('/path/to/file') == '\\path\\to\\file'

    def test_removes_colons(self):
        assert clean_location('/:Music/:folder/:') == '\\Music\\folder\\'


# Reusable factory for ENTRY dicts (Traktor uses xmltodict's @attr convention)
def _make_entry(title, artist, file_name, stem=False):
    entry = {
        '@TITLE': title,
        '@ARTIST': artist,
        'LOCATION': {
            '@DIR': '/:Music/:',
            '@FILE': file_name,
            '@VOLUME': 'D:',
        },
    }
    if stem:
        # Presence of STEMS triggers PRIMARYKEY @TYPE='STEM' in the writer
        entry['STEMS'] = {'@MASTER_GAIN': '0.0'}
    return entry


class TestWriteNmlPlaylist:
    def test_creates_file_and_returns_path(self, tmp_path):
        tracks = [_make_entry('Song A', 'Artist 1', 'a.mp3')]
        path = write_nml_playlist('My Playlist', tracks, str(tmp_path))
        assert path is not None
        assert os.path.basename(path) == 'My Playlist.nml'
        assert os.path.exists(path)

    def test_writes_valid_xml_with_collection_and_playlist_sections(self, tmp_path):
        tracks = [
            _make_entry('Song A', 'Artist 1', 'a.mp3'),
            _make_entry('Song B', 'Artist 2', 'b.mp3'),
        ]
        path = write_nml_playlist('Set', tracks, str(tmp_path))
        with open(path, 'rb') as f:
            parsed = xmltodict.parse(f)
        nml = parsed['NML']
        assert nml['COLLECTION']['@ENTRIES'] == '2'
        playlist = nml['PLAYLISTS']['NODE']
        assert playlist['@NAME'] == 'Set'
        assert playlist['PLAYLIST']['@ENTRIES'] == '2'
        keys = playlist['PLAYLIST']['ENTRY']
        assert len(keys) == 2
        # PRIMARYKEY paths reconstruct VOLUME+DIR+FILE
        assert keys[0]['PRIMARYKEY']['@KEY'] == 'D:/:Music/:a.mp3'

    def test_stem_entry_sets_primarykey_type_stem(self, tmp_path):
        tracks = [_make_entry('Stem Track', 'DJ', 's.mp3', stem=True)]
        path = write_nml_playlist('Stems', tracks, str(tmp_path))
        with open(path, 'rb') as f:
            parsed = xmltodict.parse(f)
        # Single ENTRY collapses to a dict in xmltodict
        key = parsed['NML']['PLAYLISTS']['NODE']['PLAYLIST']['ENTRY']['PRIMARYKEY']
        assert key['@TYPE'] == 'STEM'

    def test_does_not_overwrite_existing_file(self, tmp_path):
        tracks = [_make_entry('A', 'X', 'a.mp3')]
        first = write_nml_playlist('Dup', tracks, str(tmp_path))
        second = write_nml_playlist('Dup', tracks, str(tmp_path))
        third = write_nml_playlist('Dup', tracks, str(tmp_path))
        assert first.endswith('Dup.nml')
        assert second.endswith('Dup (1).nml')
        assert third.endswith('Dup (2).nml')
        for p in (first, second, third):
            assert os.path.exists(p)

    def test_sanitizes_illegal_chars(self, tmp_path):
        tracks = [_make_entry('A', 'X', 'a.mp3')]
        path = write_nml_playlist('weird: name*?', tracks, str(tmp_path))
        # Colon, asterisk, question mark must not appear in the on-disk name
        assert ':' not in os.path.basename(path)
        assert '*' not in os.path.basename(path)
        assert '?' not in os.path.basename(path)

    def test_all_illegal_chars_falls_back_to_default(self, tmp_path):
        tracks = [_make_entry('A', 'X', 'a.mp3')]
        path = write_nml_playlist('***', tracks, str(tmp_path))
        # All chars were stripped -> the writer falls back to "playlist"
        assert os.path.basename(path) == 'playlist.nml'
