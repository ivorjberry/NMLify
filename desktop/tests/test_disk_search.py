import os
import tempfile
import pytest
from disk_search import (
    parse_filename,
    scan_directories,
    build_file_index,
    fuzzy_match_files,
    filepath_to_traktor_location,
    disk_match_to_entry,
    AUDIO_EXTENSIONS,
)


class TestParseFilename:
    def test_basic(self):
        assert parse_filename("C:\\Music\\Artist - Title.mp3") == "Artist - Title"

    def test_strip_track_number(self):
        assert parse_filename("/music/01 Artist - Title.mp3") == "Artist - Title"

    def test_strip_track_number_dot(self):
        assert parse_filename("/music/03. Song Name.flac") == "Song Name"

    def test_strip_track_number_dash(self):
        assert parse_filename("/music/12 - Song Name.wav") == "Song Name"

    def test_underscores(self):
        assert parse_filename("/music/Artist_Name_-_Track.mp3") == "Artist Name - Track"

    def test_no_number(self):
        assert parse_filename("/music/Just A Song.m4a") == "Just A Song"


class TestScanDirectories:
    def test_finds_audio_files(self, tmp_path):
        # Create test audio files
        (tmp_path / "song.mp3").write_text("")
        (tmp_path / "track.flac").write_text("")
        (tmp_path / "readme.txt").write_text("")
        sub = tmp_path / "subdir"
        sub.mkdir()
        (sub / "deep.wav").write_text("")

        results = list(scan_directories([str(tmp_path)]))
        filepaths = [r[0] for r in results]
        assert len(results) == 3
        assert any("song.mp3" in fp for fp in filepaths)
        assert any("deep.wav" in fp for fp in filepaths)
        assert not any("readme.txt" in fp for fp in filepaths)

    def test_skips_nonexistent_dir(self, tmp_path):
        results = list(scan_directories([str(tmp_path / "nonexistent")]))
        assert results == []

    def test_empty_dir(self, tmp_path):
        results = list(scan_directories([str(tmp_path)]))
        assert results == []


class TestBuildFileIndex:
    def test_creates_index(self):
        file_list = [
            ("/music/Love Story.mp3", "Love Story"),
            ("/music/Story Of My Life.flac", "Story Of My Life"),
            ("/music/Blinding Lights.wav", "Blinding Lights"),
        ]
        index = build_file_index(file_list)
        assert 0 in index["love"]
        assert 0 in index["story"]
        assert 1 in index["story"]
        assert 2 in index["blinding"]


class TestFuzzyMatchFiles:
    def test_exact_match(self):
        file_list = [
            ("/music/Artist - Exact Song.mp3", "Artist - Exact Song"),
        ]
        results = fuzzy_match_files(
            ["Artist - Exact Song"], file_list, 70
        )
        assert "Artist - Exact Song" in results
        assert results["Artist - Exact Song"][0]["score"] == 100

    def test_fuzzy_match(self):
        file_list = [
            ("/music/Artistt - Exact Songg.mp3", "Artistt - Exact Songg"),
        ]
        results = fuzzy_match_files(
            ["Artist - Exact Song"], file_list, 60
        )
        assert "Artist - Exact Song" in results

    def test_no_match(self):
        file_list = [
            ("/music/Completely Different.mp3", "Completely Different"),
        ]
        results = fuzzy_match_files(
            ["Artist - Song Name"], file_list, 70
        )
        assert "Artist - Song Name" not in results

    def test_with_index(self):
        file_list = [
            ("/music/Love Story.mp3", "Love Story"),
            ("/music/Unrelated Track.mp3", "Unrelated Track"),
        ]
        index = build_file_index(file_list)
        results = fuzzy_match_files(
            ["Love Story"], file_list, 70, file_index=index
        )
        assert "Love Story" in results

    def test_sorted_by_score(self):
        file_list = [
            ("/music/Song.mp3", "Song"),
            ("/music/The Song.mp3", "The Song"),
            ("/music/Song Name.mp3", "Song Name"),
        ]
        results = fuzzy_match_files(
            ["Song"], file_list, 30
        )
        if "Song" in results:
            scores = [m["score"] for m in results["Song"]]
            assert scores == sorted(scores, reverse=True)

    def test_progress_callback_invoked_per_track(self):
        file_list = [
            ("/music/Love Story.mp3", "Love Story"),
            ("/music/Unrelated.mp3", "Unrelated"),
        ]
        calls = []
        fuzzy_match_files(
            ["Love Story", "Anything", "Other"], file_list, 70,
            progress_callback=lambda d, t: calls.append((d, t)),
        )
        assert calls == [(1, 3), (2, 3), (3, 3)]


class TestFilepathToTraktorLocation:
    def test_basic_path(self):
        loc = filepath_to_traktor_location("D:\\Music\\Artist\\song.mp3")
        assert loc["@VOLUME"] == "D:"
        assert loc["@FILE"] == "song.mp3"
        assert loc["@DIR"] == "/:Music/:Artist/:"

    def test_single_folder(self):
        loc = filepath_to_traktor_location("C:\\Songs\\track.flac")
        assert loc["@VOLUME"] == "C:"
        assert loc["@DIR"] == "/:Songs/:"
        assert loc["@FILE"] == "track.flac"

    def test_deep_path(self):
        loc = filepath_to_traktor_location("E:\\A\\B\\C\\D\\file.wav")
        assert loc["@DIR"] == "/:A/:B/:C/:D/:"

    def test_root_file(self):
        loc = filepath_to_traktor_location("D:\\file.mp3")
        assert loc["@VOLUME"] == "D:"
        assert loc["@FILE"] == "file.mp3"


class TestDiskMatchToEntry:
    def test_with_artist_title(self):
        entry = disk_match_to_entry("D:\\Music\\file.mp3", "Artist Name - Song Title")
        assert entry["@ARTIST"] == "Artist Name"
        assert entry["@TITLE"] == "Song Title"
        assert entry["LOCATION"]["@VOLUME"] == "D:"
        assert entry["LOCATION"]["@FILE"] == "file.mp3"

    def test_without_separator(self):
        entry = disk_match_to_entry("D:\\Music\\file.mp3", "Just A Track Name")
        assert entry["@ARTIST"] == ""
        assert entry["@TITLE"] == "Just A Track Name"

    def test_multiple_dashes(self):
        entry = disk_match_to_entry("D:\\Music\\file.mp3", "DJ Snake - Turn Down for What - Remix")
        assert entry["@ARTIST"] == "DJ Snake"
        assert entry["@TITLE"] == "Turn Down for What - Remix"
